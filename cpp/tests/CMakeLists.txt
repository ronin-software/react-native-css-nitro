cmake_minimum_required(VERSION 3.20)
project(nitro_css_tests CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

# Fetch doctest (header-only)
FetchContent_Declare(
  doctest
  GIT_REPOSITORY https://github.com/doctest/doctest.git
  GIT_TAG v2.4.11
)
FetchContent_MakeAvailable(doctest)

set(NITRO_MODULES_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../node_modules/react-native-nitro-modules")
set(RN_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../node_modules/react-native")

# Stage NitroModules headers flat, mirroring the CocoaPods header layout that
# <NitroModules/X.hpp> includes expect
set(STAGED_INCLUDES "${CMAKE_CURRENT_BINARY_DIR}/staged-includes")
file(MAKE_DIRECTORY "${STAGED_INCLUDES}/NitroModules")
file(GLOB_RECURSE NITRO_HEADERS "${NITRO_MODULES_ROOT}/cpp/*.hpp")
foreach(header ${NITRO_HEADERS})
  configure_file(${header} "${STAGED_INCLUDES}/NitroModules/" COPYONLY)
endforeach()

add_executable(
  css_tests
  computed_tests.cpp
  style_resolver_tests.cpp
  ../StyleResolver.cpp
  ../StyleFunction.cpp
  ../Animations.cpp
  ../VariableContext.cpp
  ../Rules.cpp
  ../Environment.cpp
  ../PseudoClasses.cpp
  ../ContainerContext.cpp
  ${RN_ROOT}/ReactCommon/jsi/jsi/jsi.cpp
  ${NITRO_MODULES_ROOT}/cpp/core/AnyMap.cpp
)

# Repo headers (../) and NitroModules headers (<NitroModules/AnyMap.hpp>)
target_include_directories(css_tests PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/..
  ${STAGED_INCLUDES}
  ${CMAKE_CURRENT_LIST_DIR}/../../nitrogen/generated/shared/c++
  ${RN_ROOT}/ReactCommon/jsi
)

# Quoted includes inside NitroModules .cpp files resolve against their own
# subdirectories (core/, utils/, ...) — add each as an include dir
file(GLOB _nitro_dirs LIST_DIRECTORIES TRUE "${NITRO_MODULES_ROOT}/cpp/*")
foreach(dir ${_nitro_dirs})
  if(IS_DIRECTORY "${dir}")
    target_include_directories(css_tests PRIVATE "${dir}")
  endif()
endforeach()

target_link_libraries(css_tests PRIVATE doctest::doctest)

target_compile_options(css_tests PRIVATE -Wall -Wextra -Wpedantic)

# –
# Native benchmark binary (mirror of src/__benchmarks__/js-runtime.bench.test.ts)
# –
add_executable(
  css_bench
  ../bench/bench.cpp
  ../StyleResolver.cpp
  ../StyleFunction.cpp
  ../Animations.cpp
  ../VariableContext.cpp
  ../Rules.cpp
  ../Environment.cpp
  ../PseudoClasses.cpp
  ../ContainerContext.cpp
  ${RN_ROOT}/ReactCommon/jsi/jsi/jsi.cpp
  ${NITRO_MODULES_ROOT}/cpp/core/AnyMap.cpp
)
target_include_directories(css_bench PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/..
  ${STAGED_INCLUDES}
  ${CMAKE_CURRENT_LIST_DIR}/../../nitrogen/generated/shared/c++
  ${RN_ROOT}/ReactCommon/jsi
)
foreach(dir ${_nitro_dirs})
  if(IS_DIRECTORY "${dir}")
    target_include_directories(css_bench PRIVATE "${dir}")
  endif()
endforeach()
