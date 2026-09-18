cmake_minimum_required(VERSION 3.20)
project(video_editor_engine LANGUAGES CXX)

add_executable(editor
    src/hello.cpp
    src/VideoEditor.cpp
)

target_compile_features(editor PRIVATE cxx_std_17)
target_link_options(editor PRIVATE
    --bind
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sENVIRONMENT=web
    -sALLOW_MEMORY_GROWTH=1
)
