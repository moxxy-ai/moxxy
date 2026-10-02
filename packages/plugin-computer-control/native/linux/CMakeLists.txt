cmake_minimum_required(VERSION 3.22)
project(moxxy_computer_linux LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
add_compile_options(-Wall -Wextra -Wpedantic)
enable_testing()

find_package(PkgConfig REQUIRED)
pkg_check_modules(DESKTOP REQUIRED IMPORTED_TARGET atspi-2 gio-unix-2.0 x11 xtst xext xfixes xcomposite xi)
# Distributions name the shared JPEG library differently (libjpeg.so.8, libjpeg.so.62), so it is linked in.
find_library(JPEG_STATIC libjpeg.a REQUIRED)
find_path(JPEG_INCLUDE jpeglib.h REQUIRED)

# What needs no desktop: the protocol, the tree, keys and geometry.
add_library(moxxy-computer-core STATIC src/json.cpp src/text.cpp src/wire.cpp src/tree.cpp src/geometry.cpp src/keys.cpp src/settle.cpp src/apps.cpp src/action.cpp)
target_include_directories(moxxy-computer-core PUBLIC src)

add_executable(moxxy-computer-tests tests/main.cpp tests/wire-test.cpp tests/tree-test.cpp tests/geometry-test.cpp tests/keys-test.cpp tests/settle-test.cpp tests/apps-test.cpp tests/action-test.cpp)
target_link_libraries(moxxy-computer-tests PRIVATE moxxy-computer-core)
add_test(NAME core COMMAND moxxy-computer-tests)

add_executable(moxxy-computer src/main.cpp src/session.cpp src/desktop.cpp src/accessibility.cpp src/guard.cpp src/cursor.cpp src/preview.cpp src/jpeg.cpp)
target_include_directories(moxxy-computer PRIVATE ${JPEG_INCLUDE})
target_link_libraries(moxxy-computer PRIVATE moxxy-computer-core PkgConfig::DESKTOP ${JPEG_STATIC} pthread)

# The test-only app the end-to-end tests drive; built where GTK 3 is installed (the build image, CI).
pkg_check_modules(GTK3 IMPORTED_TARGET gtk+-3.0)
if(GTK3_FOUND)
  add_executable(moxxy-computer-fixture fixture/main.c)
  target_link_libraries(moxxy-computer-fixture PRIVATE PkgConfig::GTK3)
endif()
