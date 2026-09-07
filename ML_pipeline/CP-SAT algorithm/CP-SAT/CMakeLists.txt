cmake_minimum_required(VERSION 3.18)

project(trackora LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(ortools CONFIG REQUIRED)

if(NOT TARGET ortools::ortools)
  message(FATAL_ERROR "Google OR-Tools target ortools::ortools was not found")
endif()

add_library(trackora_core
  src/json_io.cpp
  src/objective.cpp
  src/optimizer.cpp
  data/sample_data.cpp
)
target_include_directories(trackora_core PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/data
)
target_link_libraries(trackora_core PUBLIC ortools::ortools)

add_executable(trackora src/main.cpp)
target_link_libraries(trackora PRIVATE trackora_core)

enable_testing()
add_executable(trackora_json_test tests/test_json_io.cpp)
target_link_libraries(trackora_json_test PRIVATE trackora_core)
add_test(NAME trackora_json_test COMMAND trackora_json_test)
