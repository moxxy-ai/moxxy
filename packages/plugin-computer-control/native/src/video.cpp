#include "video.hpp"
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <codecapi.h>
#include <mutex>

namespace moxxy {
namespace {
constexpr UINT32 bitrate = 600'000;
/// Seconds between pictures a viewer can start from, when nobody asks for one.
constexpr int key_interval = 10;

void start_media_foundation() {
  static std::once_flag once;
  std::call_once(once, [] { check_hresult(MFStartup(MF_VERSION, MFSTARTUP_LITE)); });
}
com_ptr<IMFMediaType> video_type(const GUID& format, int width, int height, int fps) {
  com_ptr<IMFMediaType> type;
  check_hresult(MFCreateMediaType(type.put()));
  check_hresult(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
  check_hresult(type->SetGUID(MF_MT_SUBTYPE, format));
  check_hresult(MFSetAttributeSize(type.get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height)));
  check_hresult(MFSetAttributeRatio(type.get(), MF_MT_FRAME_RATE, static_cast<UINT32>(fps), 1));
  check_hresult(MFSetAttributeRatio(type.get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
  check_hresult(type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
  return type;
}
com_ptr<IMFTransform> find_encoder() {
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, MFVideoFormat_NV12}, output{MFMediaType_Video, MFVideoFormat_H264};
  IMFActivate** found = nullptr;
  UINT32 count = 0;
  // A synchronous encoder: one picture in, its chunk out, on this thread.
  check_hresult(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER, &input, &output, &found, &count));
  com_ptr<IMFTransform> transform;
  const HRESULT activated = count > 0 ? found[0]->ActivateObject(IID_PPV_ARGS(transform.put())) : E_FAIL;
  for (UINT32 i = 0; i < count; ++i) found[i]->Release();
  CoTaskMemFree(found);
  require(count > 0 && SUCCEEDED(activated), "capture-unavailable", "This system has no H.264 encoder");
  return transform;
}
void set(ICodecAPI* settings, const GUID& key, VARTYPE type, ULONG value) {
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = type;
  if (type == VT_BOOL) variant.boolVal = value ? VARIANT_TRUE : VARIANT_FALSE; else variant.ulVal = value;
  // Not every encoder knows every setting; the picture still comes out without it.
  settings->SetValue(&key, &variant);
}
}

VideoEncoder::VideoEncoder(int width, int height, int fps) : frame_width(width), frame_height(height), rate(std::max(1, fps)) {
  start_media_foundation();
  transform = find_encoder();
  settings = transform.try_as<ICodecAPI>();
  if (settings) {
    // No picture is held back: a live view shows each one as soon as it exists.
    set(settings.get(), CODECAPI_AVLowLatencyMode, VT_BOOL, 1);
    set(settings.get(), CODECAPI_AVEncMPVGOPSize, VT_UI4, static_cast<ULONG>(rate * key_interval));
  }
  auto output = video_type(MFVideoFormat_H264, width, height, rate);
  check_hresult(output->SetUINT32(MF_MT_AVG_BITRATE, bitrate));
  check_hresult(output->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main));
  check_hresult(transform->SetOutputType(0, output.get(), 0));
  check_hresult(transform->SetInputType(0, video_type(MFVideoFormat_NV12, width, height, rate).get(), 0));
  check_hresult(transform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0));
  check_hresult(transform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0));
}
VideoEncoder::~VideoEncoder() = default;

std::vector<VideoChunk> VideoEncoder::encode(const Pixels& picture, int64_t microseconds, bool key) {
  bgra_to_nv12(picture.bgra.data(), picture.width, picture.height, frame_width, frame_height, picture_buffer);
  const auto size = static_cast<DWORD>(picture_buffer.size());
  com_ptr<IMFMediaBuffer> buffer;
  check_hresult(MFCreateMemoryBuffer(size, buffer.put()));
  BYTE* bytes = nullptr;
  check_hresult(buffer->Lock(&bytes, nullptr, nullptr));
  memcpy(bytes, picture_buffer.data(), size);
  check_hresult(buffer->Unlock());
  check_hresult(buffer->SetCurrentLength(size));
  com_ptr<IMFSample> sample;
  check_hresult(MFCreateSample(sample.put()));
  check_hresult(sample->AddBuffer(buffer.get()));
  // Media Foundation counts time in units of 100 nanoseconds.
  check_hresult(sample->SetSampleTime(microseconds * 10));
  check_hresult(sample->SetSampleDuration(10'000'000 / rate));
  if (key && settings) set(settings.get(), CODECAPI_AVEncVideoForceKeyFrame, VT_UI4, 1);
  check_hresult(transform->ProcessInput(0, sample.get(), 0));
  return drain();
}

void VideoEncoder::remember(const std::vector<uint8_t>& sets) {
  const auto name = h264_codec(sets);
  if (!name) return;
  parameter_sets = sets;
  codec = *name;
}

std::vector<VideoChunk> VideoEncoder::drain() {
  std::vector<VideoChunk> chunks;
  for (;;) {
    MFT_OUTPUT_STREAM_INFO info{};
    check_hresult(transform->GetOutputStreamInfo(0, &info));
    const bool provided = (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) != 0;
    com_ptr<IMFSample> sample;
    if (!provided) {
      com_ptr<IMFMediaBuffer> room;
      check_hresult(MFCreateMemoryBuffer(std::max<DWORD>(info.cbSize, static_cast<DWORD>(frame_width * frame_height * 2)), room.put()));
      check_hresult(MFCreateSample(sample.put()));
      check_hresult(sample->AddBuffer(room.get()));
    }
    MFT_OUTPUT_DATA_BUFFER output{};
    output.pSample = sample.get();
    DWORD status = 0;
    const HRESULT result = transform->ProcessOutput(0, 1, &output, &status);
    if (output.pEvents) output.pEvents->Release();
    if (provided && output.pSample) sample.attach(output.pSample);
    if (result == MF_E_TRANSFORM_NEED_MORE_INPUT) break;
    if (result == MF_E_TRANSFORM_STREAM_CHANGE) {
      com_ptr<IMFMediaType> type;
      check_hresult(transform->GetOutputAvailableType(0, 0, type.put()));
      check_hresult(transform->SetOutputType(0, type.get(), 0));
      continue;
    }
    check_hresult(result);
    com_ptr<IMFMediaBuffer> flat;
    check_hresult(sample->ConvertToContiguousBuffer(flat.put()));
    BYTE* bytes = nullptr;
    DWORD length = 0;
    check_hresult(flat->Lock(&bytes, nullptr, &length));
    VideoChunk chunk;
    chunk.data.assign(bytes, bytes + length);
    check_hresult(flat->Unlock());
    LONGLONG time = 0;
    if (SUCCEEDED(sample->GetSampleTime(&time))) chunk.microseconds = std::max<LONGLONG>(0, time / 10);
    chunk.key = h264_key(chunk.data);
    if (chunk.key) {
      remember(h264_parameter_sets(chunk.data));
      // An encoder may keep the parameter sets out of the stream and only describe them in its output type.
      if (parameter_sets.empty()) {
        com_ptr<IMFMediaType> type;
        UINT32 size = 0;
        if (SUCCEEDED(transform->GetOutputCurrentType(0, type.put())) && SUCCEEDED(type->GetBlobSize(MF_MT_MPEG_SEQUENCE_HEADER, &size)) && size > 0) {
          std::vector<uint8_t> header(size);
          if (SUCCEEDED(type->GetBlob(MF_MT_MPEG_SEQUENCE_HEADER, header.data(), size, nullptr))) remember(h264_parameter_sets(header));
        }
      }
      chunk.data = with_parameter_sets(chunk.data, parameter_sets);
    }
    // Nothing can be decoded before the parameter sets are known.
    if (codec.empty()) continue;
    chunk.codec = codec;
    chunks.push_back(std::move(chunk));
  }
  return chunks;
}
}
