#include <emscripten/bind.h>

#include "VideoEditor.h"

int add(int a, int b) {
    return a + b;
}

EMSCRIPTEN_BINDINGS(video_editor) {
    emscripten::function("add", &add);
    emscripten::value_object<SpliceResult>("SpliceResult")
        .field("valid", &SpliceResult::valid)
        .field("firstStart", &SpliceResult::firstStart)
        .field("firstEnd", &SpliceResult::firstEnd)
        .field("secondStart", &SpliceResult::secondStart)
        .field("secondEnd", &SpliceResult::secondEnd);
    emscripten::value_object<RangeSpliceResult>("RangeSpliceResult")
        .field("valid", &RangeSpliceResult::valid)
        .field("hasBefore", &RangeSpliceResult::hasBefore)
        .field("hasAfter", &RangeSpliceResult::hasAfter)
        .field("beforeStart", &RangeSpliceResult::beforeStart)
        .field("beforeEnd", &RangeSpliceResult::beforeEnd)
        .field("selectionStart", &RangeSpliceResult::selectionStart)
        .field("selectionEnd", &RangeSpliceResult::selectionEnd)
        .field("afterStart", &RangeSpliceResult::afterStart)
        .field("afterEnd", &RangeSpliceResult::afterEnd);
    emscripten::value_object<SpotifyTrackRecord>("SpotifyTrackRecord")
        .field("id", &SpotifyTrackRecord::id)
        .field("name", &SpotifyTrackRecord::name)
        .field("artists", &SpotifyTrackRecord::artists)
        .field("duration", &SpotifyTrackRecord::duration)
        .field("spotifyUrl", &SpotifyTrackRecord::spotifyUrl);
    emscripten::function("spliceClip", &spliceClip);
    emscripten::function("spliceRange", &spliceRange);
    emscripten::function("pushUndoState", &pushUndoState);
    emscripten::function("canUndo", &canUndo);
    emscripten::function("popUndoState", &popUndoState);
    emscripten::function("clearUndoHistory", &clearUndoHistory);
    emscripten::function("timelinePlayheadPercent", &timelinePlayheadPercent);
    emscripten::function("timelineTimeFromPercent", &timelineTimeFromPercent);
    emscripten::function("saveSpotifyTrack", &saveSpotifyTrack);
    emscripten::function("spotifyTrackCount", &spotifyTrackCount);
    emscripten::function("getSpotifyTrack", &getSpotifyTrack);
    emscripten::function("saveAudioAsset", &saveAudioAsset);
    emscripten::function("audioAssetSize", &audioAssetSize);
}
