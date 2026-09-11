#include "common.hpp"
#include <d3d11.h>
#include <dxgi.h>
#include <wincrypt.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Foundation.Collections.h>

namespace moxxy {
namespace {
std::vector<uint8_t> capture_graphics(HWND hwnd, Rect bounds) {
  using namespace Windows::Graphics;
  using namespace Windows::Graphics::Capture;
  require(GraphicsCaptureSession::IsSupported(), "capture-unavailable", "Windows Graphics Capture is unavailable");
  com_ptr<ID3D11Device> device;
  com_ptr<ID3D11DeviceContext> context;
  check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
  auto dxgi = device.as<IDXGIDevice>();
  com_ptr<IInspectable> inspectable;
  check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
  auto runtime_device = inspectable.as<DirectX::Direct3D11::IDirect3DDevice>();
  auto factory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  GraphicsCaptureItem item{nullptr};
  check_hresult(factory->CreateForWindow(hwnd, guid_of<GraphicsCaptureItem>(), put_abi(item)));
  auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(runtime_device, DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, item.Size());
  auto session = pool.CreateCaptureSession(item);
  struct Close { GraphicsCaptureSession session; Direct3D11CaptureFramePool pool; ~Close() { session.Close(); pool.Close(); } } close{session, pool};
  session.StartCapture();
  Direct3D11CaptureFrame frame{nullptr};
  for (int tries=0; tries<200 && !frame; ++tries) {
    require(WaitForSingleObject(stop_event, 10) == WAIT_TIMEOUT, "cancelled", "Capture cancelled");
    frame = pool.TryGetNextFrame();
  }
  require(frame != nullptr, "capture-timeout", "Window produced no frame; try explicit visible fallback");
  auto size = frame.ContentSize();
  require(size.Width == bounds.width && size.Height == bounds.height, "capture-geometry", "Capture geometry changed or is unsupported");
  auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  com_ptr<ID3D11Texture2D> source;
  check_hresult(access->GetInterface(guid_of<ID3D11Texture2D>(), source.put_void()));
  D3D11_TEXTURE2D_DESC description; source->GetDesc(&description);
  description.Usage = D3D11_USAGE_STAGING; description.BindFlags = 0;
  description.CPUAccessFlags = D3D11_CPU_ACCESS_READ; description.MiscFlags = 0;
  com_ptr<ID3D11Texture2D> staging; check_hresult(device->CreateTexture2D(&description, nullptr, staging.put()));
  context->CopyResource(staging.get(), source.get());
  D3D11_MAPPED_SUBRESOURCE mapped;
  check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
  struct Unmap { ID3D11DeviceContext* context; ID3D11Texture2D* texture; ~Unmap() { context->Unmap(texture,0); } } unmap{context.get(), staging.get()};
  std::vector<uint8_t> pixels(static_cast<size_t>(bounds.width)*bounds.height*4);
  for (int row=0; row<bounds.height; ++row)
    memcpy(pixels.data()+static_cast<size_t>(row)*bounds.width*4, static_cast<uint8_t*>(mapped.pData)+static_cast<size_t>(row)*mapped.RowPitch, bounds.width*4);
  frame.Close(); return pixels;
}
std::vector<uint8_t> capture_visible(HWND hwnd, Rect bounds) {
  check_focus(hwnd);
  int x = GetSystemMetrics(SM_XVIRTUALSCREEN), y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  require(bounds.x >= x && bounds.y >= y && bounds.x+bounds.width <= x+GetSystemMetrics(SM_CXVIRTUALSCREEN) &&
    bounds.y+bounds.height <= y+GetSystemMetrics(SM_CYVIRTUALSCREEN), "capture-geometry", "Window lies outside visible desktop");
  HDC screen = GetDC(nullptr);
  require(screen != nullptr, "capture-unavailable", "Screen capture unavailable");
  struct ReleaseDCGuard { HDC dc; ~ReleaseDCGuard() { ReleaseDC(nullptr, dc); } } release{screen};
  HDC memory = CreateCompatibleDC(screen);
  require(memory != nullptr, "capture-unavailable", "Cannot allocate capture context");
  struct DeleteDCGuard { HDC dc; ~DeleteDCGuard() { DeleteDC(dc); } } delete_dc{memory};
  BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = bounds.width; info.bmiHeader.biHeight = -bounds.height;
  info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
  void* data = nullptr;
  auto bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &data, nullptr, 0);
  require(bitmap && data, "capture-unavailable", "Cannot allocate capture bitmap");
  auto previous = SelectObject(memory, bitmap);
  struct Restore { HDC dc; HGDIOBJ old; HBITMAP bitmap; ~Restore() { SelectObject(dc,old); DeleteObject(bitmap); } } restore{memory,previous,bitmap};
  require(BitBlt(memory,0,0,bounds.width,bounds.height,screen,bounds.x,bounds.y,SRCCOPY|CAPTUREBLT), "capture-unavailable", "Visible capture failed");
  GdiFlush();
  auto begin = static_cast<uint8_t*>(data);
  return {begin, begin+static_cast<size_t>(bounds.width)*bounds.height*4};
}
}
Capture capture_window(HWND hwnd, int max_dim, bool jpeg, int quality, bool allow_fallback) {
  using namespace Windows::Graphics::Imaging;
  using namespace Windows::Storage::Streams;
  auto bounds = window_bounds(hwnd);
  require(static_cast<uint64_t>(bounds.width)*bounds.height <= 16'777'216, "capture-limit", "Capture source is too large");
  std::vector<uint8_t> pixels;
  bool fallback = false;
  try { pixels = capture_graphics(hwnd, bounds); }
  catch (...) {
    if (!allow_fallback) throw;
    pixels = capture_visible(hwnd, bounds); fallback = true;
  }
  double scale = std::min(1.0, static_cast<double>(max_dim)/std::max(bounds.width,bounds.height));
  int width = std::max(1,static_cast<int>(bounds.width*scale)), height = std::max(1,static_cast<int>(bounds.height*scale));
  InMemoryRandomAccessStream stream;
  BitmapPropertySet properties;
  if (jpeg) properties.Insert(L"ImageQuality", BitmapTypedValue(box_value(static_cast<float>(quality)/100), Windows::Foundation::PropertyType::Single));
  auto encoder = BitmapEncoder::CreateAsync(jpeg ? BitmapEncoder::JpegEncoderId() : BitmapEncoder::PngEncoderId(), stream, properties).get();
  encoder.SetPixelData(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, bounds.width, bounds.height, 96,96,pixels);
  encoder.BitmapTransform().ScaledWidth(width); encoder.BitmapTransform().ScaledHeight(height);
  encoder.FlushAsync().get();
  require(stream.Size() <= 1'500'000, "capture-limit", "Encoded capture too large; reduce maxDim or quality");
  std::vector<uint8_t> encoded(static_cast<size_t>(stream.Size()));
  DataReader reader(stream.GetInputStreamAt(0)); reader.LoadAsync(static_cast<uint32_t>(encoded.size())).get(); reader.ReadBytes(encoded);
  DWORD length = 0;
  require(CryptBinaryToStringA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF, nullptr, &length), "native-error", "Cannot encode capture");
  std::string base64(length, '\0');
  require(CryptBinaryToStringA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF, base64.data(), &length), "native-error", "Cannot encode capture");
  if (!base64.empty() && base64.back() == '\0') base64.pop_back();
  return {bounds,width,height,std::move(base64),jpeg ? L"image/jpeg" : L"image/png",fallback};
}
}
