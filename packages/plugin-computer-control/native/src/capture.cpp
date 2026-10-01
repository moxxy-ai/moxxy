#include "capture.hpp"
#include <wincrypt.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Foundation.Collections.h>

namespace moxxy {
using namespace Windows::Graphics;
using namespace Windows::Graphics::Capture;

WindowStream::WindowStream(HWND window) : target(window) {
  require(GraphicsCaptureSession::IsSupported(), "capture-unavailable", "Windows Graphics Capture is unavailable");
  check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
  auto dxgi = device.as<IDXGIDevice>();
  com_ptr<IInspectable> inspectable;
  check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
  runtime_device = inspectable.as<Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
  auto factory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  check_hresult(factory->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
  size = item.Size();
  pool = Direct3D11CaptureFramePool::CreateFreeThreaded(runtime_device, Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
  session = pool.CreateCaptureSession(item);
  // The user's pointer is not application content. Including it makes an
  // unchanged window look different whenever the human moves the mouse.
  session.IsCursorCaptureEnabled(false);
  session.StartCapture();
}
WindowStream::~WindowStream() {
  try { if (session) session.Close(); if (pool) pool.Close(); } catch (...) { /* The window may already be gone. */ }
}
bool WindowStream::latest(Pixels& output) {
  Direct3D11CaptureFrame frame{nullptr};
  // Only the newest frame matters; older ones are dropped.
  while (auto next = pool.TryGetNextFrame()) { if (frame) frame.Close(); frame = next; }
  if (!frame) return false;
  auto content = frame.ContentSize();
  if (content.Width != size.Width || content.Height != size.Height) {
    // The window was resized: later frames come at the new size.
    frame.Close();
    require(content.Width > 0 && content.Height > 0, "capture-geometry", "The window has no size");
    size = content;
    pool.Recreate(runtime_device, Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    return false;
  }
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
  const int width = std::min<int>(content.Width, static_cast<int>(description.Width));
  const int height = std::min<int>(content.Height, static_cast<int>(description.Height));
  output.width = width; output.height = height;
  output.bgra.resize(static_cast<size_t>(width) * height * 4);
  for (int row = 0; row < height; ++row)
    memcpy(output.bgra.data() + static_cast<size_t>(row) * width * 4, static_cast<uint8_t*>(mapped.pData) + static_cast<size_t>(row) * mapped.RowPitch, static_cast<size_t>(width) * 4);
  frame.Close(); return true;
}
Pixels capture_window_pixels(HWND hwnd) {
  auto bounds = window_bounds(hwnd);
  require(static_cast<uint64_t>(bounds.width) * bounds.height <= 16'777'216, "capture-limit", "Capture source is too large");
  WindowStream stream(hwnd);
  Pixels pixels;
  for (int tries = 0; tries < 200; ++tries) {
    require(WaitForSingleObject(stop_event, 10) == WAIT_TIMEOUT, "cancelled", "Capture cancelled");
    if (stream.latest(pixels)) return pixels;
  }
  throw Error("capture-timeout", "The window produced no picture");
}
Pixels capture_screen_pixels(Rect bounds) {
  require(bounds.width > 0 && bounds.height > 0 && static_cast<uint64_t>(bounds.width) * bounds.height <= 33'177'600,
    "capture-geometry", "The display has no usable size");
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
  return {std::vector<uint8_t>(begin, begin + static_cast<size_t>(bounds.width) * bounds.height * 4), bounds.width, bounds.height};
}
Pixels crop_pixels(const Pixels& source, Rect region) {
  require(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 &&
    region.x + region.width <= source.width && region.y + region.height <= source.height, "point_outside_frame", "The region is not inside the picture");
  Pixels result{std::vector<uint8_t>(static_cast<size_t>(region.width) * region.height * 4), region.width, region.height};
  for (int row = 0; row < region.height; ++row)
    memcpy(result.bgra.data() + static_cast<size_t>(row) * region.width * 4,
      source.bgra.data() + (static_cast<size_t>(row + region.y) * source.width + region.x) * 4, static_cast<size_t>(region.width) * 4);
  return result;
}
void keep_only(Pixels& pixels, HRGN keep) {
  HDC screen = GetDC(nullptr);
  require(screen != nullptr, "capture-unavailable", "Screen capture unavailable");
  struct ReleaseDCGuard { HDC dc; ~ReleaseDCGuard() { ReleaseDC(nullptr, dc); } } release{screen};
  HDC memory = CreateCompatibleDC(screen);
  require(memory != nullptr, "capture-unavailable", "Cannot allocate mask context");
  struct DeleteDCGuard { HDC dc; ~DeleteDCGuard() { DeleteDC(dc); } } delete_dc{memory};
  BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = pixels.width; info.bmiHeader.biHeight = -pixels.height;
  info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
  void* data = nullptr;
  auto bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &data, nullptr, 0);
  require(bitmap && data, "capture-unavailable", "Cannot allocate mask bitmap");
  auto previous = SelectObject(memory, bitmap);
  struct Restore { HDC dc; HGDIOBJ old; HBITMAP bitmap; ~Restore() { SelectObject(dc,old); DeleteObject(bitmap); } } restore{memory,previous,bitmap};
  RECT all{0, 0, pixels.width, pixels.height};
  FillRect(memory, &all, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
  FillRgn(memory, keep, static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
  GdiFlush();
  auto mask = static_cast<const uint8_t*>(data);
  const size_t count = static_cast<size_t>(pixels.width) * pixels.height;
  for (size_t i = 0; i < count; ++i) if (!mask[i * 4]) memset(pixels.bgra.data() + i * 4, 0, 4);
}
std::pair<int,int> image_budget(int width, int height) {
  const auto fits = [](int w, int h) { return w <= 1568 && h <= 1568 && ((w + 27) / 28) * ((h + 27) / 28) <= 1568; };
  require(width >= 1 && height >= 1, "capture-geometry", "Image size must be positive");
  if (fits(width, height)) return {width, height};
  if (height > width) { auto turned = image_budget(height, width); return {turned.second, turned.first}; }
  const double aspect = static_cast<double>(width) / height;
  const auto height_for = [&](int w) { return std::max(1, static_cast<int>(std::lround(w / aspect))); };
  // `low` always fits, `high` never does.
  int low = 1, high = width;
  while (high - low > 1) {
    int middle = (low + high) / 2;
    if (fits(middle, height_for(middle))) low = middle; else high = middle;
  }
  return {low, height_for(low)};
}
std::string encode_pixels(const Pixels& source, int width, int height, bool jpeg, int quality) {
  using namespace Windows::Graphics::Imaging;
  using namespace Windows::Storage::Streams;
  require(source.width > 0 && source.height > 0 && width > 0 && height > 0, "capture-geometry", "Nothing to encode");
  InMemoryRandomAccessStream stream;
  BitmapPropertySet properties;
  if (jpeg) properties.Insert(L"ImageQuality", BitmapTypedValue(box_value(static_cast<float>(quality)/100), Windows::Foundation::PropertyType::Single));
  auto encoder = BitmapEncoder::CreateAsync(jpeg ? BitmapEncoder::JpegEncoderId() : BitmapEncoder::PngEncoderId(), stream, properties).get();
  encoder.SetPixelData(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, source.width, source.height, 96, 96, source.bgra);
  encoder.BitmapTransform().ScaledWidth(width); encoder.BitmapTransform().ScaledHeight(height);
  encoder.BitmapTransform().InterpolationMode(BitmapInterpolationMode::Fant);
  encoder.FlushAsync().get();
  require(stream.Size() <= 1'500'000, "capture-limit", "Encoded picture is too large");
  std::vector<uint8_t> encoded(static_cast<size_t>(stream.Size()));
  DataReader reader(stream.GetInputStreamAt(0)); reader.LoadAsync(static_cast<uint32_t>(encoded.size())).get(); reader.ReadBytes(encoded);
  DWORD length = 0;
  require(CryptBinaryToStringA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF, nullptr, &length), "native-error", "Cannot encode capture");
  std::string base64(length, '\0');
  require(CryptBinaryToStringA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF, base64.data(), &length), "native-error", "Cannot encode capture");
  if (!base64.empty() && base64.back() == '\0') base64.pop_back();
  return base64;
}
}
