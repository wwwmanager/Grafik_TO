cmake_minimum_required(VERSION 3.20)
project(grafik_to VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(CMAKE_SYSTEM_NAME STREQUAL "Windows")
    add_compile_definitions(_WIN32_WINNT=0x0601 NTDDI_VERSION=0x06010000 WINVER=0x0601)
    # GUI subsystem for main target
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--subsystem,windows")
endif()

# Qt 5.15
find_package(Qt5 5.15 REQUIRED COMPONENTS Widgets PrintSupport Svg)

# Source files
file(GLOB_RECURSE GRAFIK_SOURCES "src/*.cpp" "src/*.hpp" "include/*.hpp")

add_executable(grafik_to WIN32 ${GRAFIK_SOURCES})
target_include_directories(grafik_to PRIVATE include)
target_link_libraries(grafik_to PRIVATE Qt5::Widgets Qt5::PrintSupport Qt5::Svg)

# Resources (icons, themes, etc.)
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/resources/resources.qrc")
    qt5_add_resources(GRAFIK_RESOURCES "${CMAKE_CURRENT_SOURCE_DIR}/resources/resources.qrc")
    target_sources(grafik_to PRIVATE ${GRAFIK_RESOURCES})
endif()

# Tests
enable_testing()
add_subdirectory(tests)

# Install (optional)
install(TARGETS grafik_to RUNTIME DESTINATION bin)