#include "jpeg.hpp"

#include <cstdio>
#include <cstdlib>
#include <jpeglib.h>

#include "text.hpp"

namespace moxxy {

std::vector<uint8_t> encode_jpeg(const Pixels& pixels, int quality) {
  jpeg_compress_struct compress;
  jpeg_error_mgr errors;
  compress.err = jpeg_std_error(&errors);
  jpeg_create_compress(&compress);
  unsigned char* buffer = nullptr;
  unsigned long size = 0;
  jpeg_mem_dest(&compress, &buffer, &size);
  compress.image_width = pixels.width;
  compress.image_height = pixels.height;
  compress.input_components = 3;
  compress.in_color_space = JCS_RGB;
  jpeg_set_defaults(&compress);
  jpeg_set_quality(&compress, quality, TRUE);
  jpeg_start_compress(&compress, TRUE);
  while (compress.next_scanline < compress.image_height) {
    JSAMPROW row = const_cast<JSAMPROW>(&pixels.rgb[size_t(compress.next_scanline) * pixels.width * 3]);
    jpeg_write_scanlines(&compress, &row, 1);
  }
  jpeg_finish_compress(&compress);
  jpeg_destroy_compress(&compress);
  std::vector<uint8_t> bytes(buffer, buffer + size);
  std::free(buffer);
  return bytes;
}

Json image_json(const Pixels& pixels, int quality) {
  const auto bytes = encode_jpeg(pixels, quality);
  return Json::Object{{"mediaType", "image/jpeg"}, {"base64", base64(bytes.data(), bytes.size())}, {"width", pixels.width}, {"height", pixels.height}};
}

}  // namespace moxxy
