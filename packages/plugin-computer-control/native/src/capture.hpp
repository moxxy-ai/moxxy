#pragma once
#include "common.hpp"
#include <d3d11.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

namespace moxxy {
/// One open Windows Graphics Capture session on a window; a preview keeps it open between frames.
class WindowStream {
 public:
  explicit WindowStream(HWND window);
  ~WindowStream();
  WindowStream(const WindowStream&) = delete;
  WindowStream& operator=(const WindowStream&) = delete;
  /// The newest frame the window produced since the last call; false when nothing changed.
  bool latest(Pixels& output);
  HWND window() const { return target; }
 private:
  HWND target;
  com_ptr<ID3D11Device> device;
  com_ptr<ID3D11DeviceContext> context;
  Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice runtime_device{nullptr};
  Windows::Graphics::Capture::GraphicsCaptureItem item{nullptr};
  Windows::Graphics::Capture::Direct3D11CaptureFramePool pool{nullptr};
  Windows::Graphics::Capture::GraphicsCaptureSession session{nullptr};
  Windows::Graphics::SizeInt32 size{};
};
}
