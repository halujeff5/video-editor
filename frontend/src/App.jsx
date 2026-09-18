import { Fragment, useEffect, useRef, useState } from "react";
import "./App.css";
import AddTextModal from "./components/AddTextModal.jsx";
import AddTransitionModal from "./components/AddTransitionModal.jsx";
import LoadProjectModal from "./components/LoadProjectModal.jsx";
import MusicPickerModal from "./components/MusicPickerModal.jsx";
import PhotoDurationModal from "./components/PhotoDurationModal.jsx";
import createEditorModule from "./wasm/editor.js";

const TIMELINE_PADDING_SECONDS = 10;
const DEFAULT_PHOTO_DURATION = 5;
const TIMELINE_PIXELS_PER_SECOND = 10;

function isPhoto(media) {
  return media?.mediaKind === "image" || media?.type?.startsWith("image/");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatTimelineTime(seconds) {
  const sign = seconds < 0 ? "-" : "";
  return `${sign}${formatTime(Math.abs(seconds))}`;
}

function getClipDuration(video) {
  if (Number.isFinite(video.sourceEnd)) {
    return video.sourceEnd - (video.sourceStart || 0);
  }
  return video.duration || 0;
}

function getFadeOverlay(videos, transitions, timelineTime) {
  let boundaryTime = 0;
  let activeFade = { color: "#000", opacity: 0 };

  for (let index = 0; index < videos.length - 1; index += 1) {
    const leftClip = videos[index];
    const rightClip = videos[index + 1];
    const leftDuration = getClipDuration(leftClip);
    boundaryTime += leftDuration;
    const transition = transitions[`${leftClip.clipId}:${rightClip.clipId}`];
    if (transition?.type !== "fade-black" && transition?.type !== "fade-white") continue;

    const halfDuration = Math.max(0.05, (Number(transition.duration) || 1) / 2);
    const fadeOutDuration = Math.min(halfDuration, leftDuration);
    const fadeInDuration = Math.min(halfDuration, getClipDuration(rightClip));
    let opacity = 0;
    if (timelineTime >= boundaryTime - fadeOutDuration && timelineTime <= boundaryTime) {
      opacity = (timelineTime - (boundaryTime - fadeOutDuration)) / fadeOutDuration;
    } else if (timelineTime > boundaryTime && timelineTime <= boundaryTime + fadeInDuration) {
      opacity = 1 - ((timelineTime - boundaryTime) / fadeInDuration);
    }
    if (opacity > activeFade.opacity) {
      activeFade = {
        color: transition.type === "fade-white" ? "#fff" : "#000",
        opacity,
      };
    }
  }

  return {
    ...activeFade,
    opacity: Math.max(0, Math.min(1, activeFade.opacity)),
  };
}

function buildTimeOptions(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const intervalCount = Math.min(120, Math.max(1, Math.ceil(duration * 2)));
  return Array.from(
    { length: intervalCount + 1 },
    (_, index) => (duration * index) / intervalCount,
  );
}

function formatPreciseTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${remainingSeconds}`;
}

function readAudioDuration(url) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error("Unable to read the audio duration"));
    audio.src = url;
  });
}

function App() {
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [editingVideos, setEditingVideos] = useState([]);
  const [editingMusic, setEditingMusic] = useState([]);
  const [textOverlays, setTextOverlays] = useState([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [timelineDragMode, setTimelineDragMode] = useState(null);
  const [activeClipId, setActiveClipId] = useState(null);
  const [activeMusicClipId, setActiveMusicClipId] = useState(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [editorEngine, setEditorEngine] = useState(null);
  const [spliceError, setSpliceError] = useState("");
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [errorFlashKey, setErrorFlashKey] = useState(0);
  const [clipMenu, setClipMenu] = useState(null);
  const [transitionMenu, setTransitionMenu] = useState(null);
  const [transitionEditor, setTransitionEditor] = useState(null);
  const [playheadMenu, setPlayheadMenu] = useState(null);
  const [textEditor, setTextEditor] = useState(null);
  const [videoTransitions, setVideoTransitions] = useState({});
  const [appMenu, setAppMenu] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [draggedClipId, setDraggedClipId] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [universalPlaybackTime, setUniversalPlaybackTime] = useState(0);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const [musicTrack, setMusicTrack] = useState(null);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicError, setMusicError] = useState("");
  const [projectSaveStatus, setProjectSaveStatus] = useState("idle");
  const [savedProjects, setSavedProjects] = useState([]);
  const [showProjectLoader, setShowProjectLoader] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [soundstripeTracks, setSoundstripeTracks] = useState([]);
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [pendingPhotoDrop, setPendingPhotoDrop] = useState(null);
  const previewRef = useRef(null);
  const musicInputRef = useRef(null);
  const continuePlaybackRef = useRef(false);
  const preserveTimelineOnPauseRef = useRef(false);
  const timelineTrackRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const musicAudioRefs = useRef(new Map());
  const musicPlayPendingRef = useRef(new Set());
  const musicDragOffsetRef = useRef(0);
  const photoDragOffsetRef = useRef(0);
  const musicStorageReadyRef = useRef(false);
  const textStorageReadyRef = useRef(false);
  const timelinePlayingRef = useRef(false);
  const timelineAnimationRef = useRef(null);
  const savingProjectRef = useRef(false);

  const floatingPhotos = editingVideos.filter((clip) => (
    isPhoto(clip) && Number.isFinite(clip.timelineStart)
  ));
  const chainedVisualClips = editingVideos.filter((clip) => !(
    isPhoto(clip) && Number.isFinite(clip.timelineStart)
  ));
  const chainedVisualDuration = chainedVisualClips.reduce(
    (total, video) => total + getClipDuration(video),
    0,
  );
  const floatingPhotoEnd = floatingPhotos.reduce(
    (end, photo) => Math.max(end, photo.timelineStart + getClipDuration(photo)),
    0,
  );
  const timelineDuration = Math.max(chainedVisualDuration, floatingPhotoEnd);
  const activeClipIndex = editingVideos.findIndex(
    (video) => video.clipId === activeClipId,
  );
  const activeTimelineClip = editingVideos[activeClipIndex] ?? null;
  const activeMusicIndex = editingMusic.findIndex(
    (track) => track.clipId === activeMusicClipId,
  );
  const activeMusicClip = editingMusic[activeMusicIndex] ?? null;
  const activeEditClip = activeMusicClip ?? activeTimelineClip;
  const activeClipDuration = activeEditClip
    ? getClipDuration(activeEditClip)
    : 0;
  const musicTimelineEnd = editingMusic.reduce(
    (end, track) => Math.max(end, (track.timelineStart || 0) + getClipDuration(track)),
    0,
  );
  const textTimelineEnd = textOverlays.reduce(
    (end, overlay) => Math.max(end, overlay.timelineStart + overlay.duration),
    0,
  );
  const contentDuration = Math.max(
    timelineDuration,
    musicTimelineEnd,
    textTimelineEnd,
    0,
  );
  const timelineStartTime = -TIMELINE_PADDING_SECONDS;
  const timelineEndTime = contentDuration + TIMELINE_PADDING_SECONDS;
  const playbackEndTime = contentDuration;
  const projectDuration = timelineEndTime - timelineStartTime;
  const firstTimelineTick = Math.ceil(timelineStartTime / 10) * 10;
  const timelineTicks = Array.from(
    { length: Math.floor((timelineEndTime - firstTimelineTick) / 10) + 1 },
    (_, index) => firstTimelineTick + index * 10,
  );
  const firstSecondTick = Math.ceil(timelineStartTime);
  const timelineSecondTicks = Array.from(
    { length: Math.floor(timelineEndTime - firstSecondTick) + 1 },
    (_, index) => firstSecondTick + index,
  );
  const timelineContentWidth = Math.max(
    640,
    projectDuration * TIMELINE_PIXELS_PER_SECOND,
  );
  const activeTextOverlays = textOverlays.filter((overlay) => (
    universalPlaybackTime >= overlay.timelineStart
    && universalPlaybackTime < overlay.timelineStart + overlay.duration
  ));
  const rangeOptions = buildTimeOptions(activeClipDuration);
  const invalidRange = selectionStart >= selectionEnd;
  const elapsedBeforeActiveClip = Number.isFinite(activeTimelineClip?.timelineStart)
    ? activeTimelineClip.timelineStart
    : chainedVisualClips
      .slice(0, Math.max(chainedVisualClips.findIndex(
        (clip) => clip.clipId === activeClipId,
      ), 0))
      .reduce((total, video) => total + getClipDuration(video), 0);
  const selectedPhotoIsVisible = !selectedVideo
    || !isPhoto(selectedVideo)
    || activeClipId === null
    || (
      universalPlaybackTime >= elapsedBeforeActiveClip
      && universalPlaybackTime < elapsedBeforeActiveClip + getClipDuration(selectedVideo)
    );
  const fadeOverlay = getFadeOverlay(
    chainedVisualClips,
    videoTransitions,
    universalPlaybackTime,
  );
  useEffect(() => {
    let cancelled = false;
    createEditorModule().then((module) => {
      if (!cancelled) setEditorEngine(module);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const clearTimelineDragState = () => {
      setIsDraggingOver(false);
      setTimelineDragMode(null);
    };
    window.addEventListener("dragend", clearTimelineDragState);
    window.addEventListener("drop", clearTimelineDragState);
    return () => {
      window.removeEventListener("dragend", clearTimelineDragState);
      window.removeEventListener("drop", clearTimelineDragState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/project/music")
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.tracks)) {
          musicStorageReadyRef.current = true;
          if (payload.tracks.length > 0) setEditingMusic(payload.tracks);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!musicStorageReadyRef.current) return;
    fetch("/api/project/music", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingMusic),
    }).catch(() => {});
  }, [editingMusic]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/project/text")
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.overlays)) {
          textStorageReadyRef.current = true;
          setTextOverlays(payload.overlays);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!textStorageReadyRef.current) return;
    const saveTimer = window.setTimeout(() => {
      fetch("/api/project/text", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(textOverlays),
      }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(saveTimer);
  }, [textOverlays]);

  useEffect(() => {
    if (!clipMenu && !transitionMenu && !playheadMenu && !appMenu) return undefined;

    const closeMenu = () => {
      setClipMenu(null);
      setTransitionMenu(null);
      setPlayheadMenu(null);
      setAppMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [clipMenu, transitionMenu, playheadMenu, appMenu]);

  useEffect(() => () => {
    timelinePlayingRef.current = false;
    if (timelineAnimationRef.current) {
      cancelAnimationFrame(timelineAnimationRef.current);
    }
    for (const audio of musicAudioRefs.current.values()) {
      audio.pause();
    }
  }, []);

  useEffect(() => {
    if (previewRef.current && activeTimelineClip) {
      previewRef.current.volume = activeTimelineClip.volume ?? 1;
    }
  }, [activeTimelineClip]);

  function saveUndoSnapshot() {
    if (!editorEngine) return;
    editorEngine.pushUndoState(JSON.stringify({
      editingVideos,
      editingMusic,
      videoTransitions,
      textOverlays,
      activeClipId,
      activeMusicClipId,
      selectedVideo,
      playbackTime,
      selectionStart,
      selectionEnd,
    }));
    setCanUndo(editorEngine.canUndo());
  }

  function undoPreviousEdit() {
    if (!editorEngine?.canUndo()) return;
    const serializedSnapshot = editorEngine.popUndoState();
    if (!serializedSnapshot) return;
    const snapshot = JSON.parse(serializedSnapshot);

    setEditingVideos(snapshot.editingVideos);
    setEditingMusic(snapshot.editingMusic ?? []);
    setVideoTransitions(snapshot.videoTransitions ?? {});
    setTextOverlays(snapshot.textOverlays ?? []);
    setActiveClipId(snapshot.activeClipId);
    setActiveMusicClipId(snapshot.activeMusicClipId ?? null);
    setSelectedVideo(snapshot.selectedVideo);
    setPlaybackTime(snapshot.playbackTime);
    setSelectionStart(snapshot.selectionStart);
    setSelectionEnd(snapshot.selectionEnd);
    setSpliceError("");
    setClipMenu(null);
    setTransitionMenu(null);
    setPlayheadMenu(null);
    setAppMenu(null);
    setCanUndo(editorEngine.canUndo());
  }

  const playheadPosition = editorEngine
    ? editorEngine.timelinePlayheadPercent(
        projectDuration,
        0,
        universalPlaybackTime - timelineStartTime,
      )
    : 0;

  function handleVideoUpload(event) {
    const files = Array.from(event.target.files).filter((file) => (
      file.type.startsWith("video/") || file.type.startsWith("image/")
    ));
    const newVideos = files.map((file) => ({
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
      type: file.type,
      mediaKind: file.type.startsWith("image/") ? "image" : "video",
      duration: file.type.startsWith("image/") ? DEFAULT_PHOTO_DURATION : undefined,
    }));
    setVideos((current) => [...current, ...newVideos]);
    setSelectedVideo((current) => current ?? newVideos[0] ?? null);
  }

  async function handleAddMusic() {
    setMusicLoading(true);
    setMusicError("");
    try {
      const response = await fetch("/api/soundstripe/tracks");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load Soundstripe music");
      setSoundstripeTracks(payload.tracks);
      setShowMusicPicker(true);
    } catch (error) {
      setMusicError(error.message);
    } finally {
      setMusicLoading(false);
    }
  }

  async function handleMusicUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!editorEngine) {
      setMusicError("The editor engine is still loading.");
      return;
    }

    setMusicLoading(true);
    setMusicError("");
    try {
      const url = URL.createObjectURL(file);
      const [bytes, duration] = await Promise.all([
        file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        readAudioDuration(url),
      ]);
      const uploadResponse = await fetch("/api/audio-assets", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: bytes,
      });
      const upload = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(upload.error || "Unable to store audio");
      const backendAssetId = editorEngine.saveAudioAsset(file.name, bytes);
      const musicClip = {
        source: "local",
        name: file.name,
        artists: "Local audio",
        url: `${upload.url}?type=${encodeURIComponent(file.type || "audio/mpeg")}`,
        duration,
        sourceStart: 0,
        sourceEnd: duration,
        timelineStart: 0,
        backendAssetId,
        persistentAssetId: upload.assetId,
        clipId: crypto.randomUUID(),
        kind: "music",
        volume: 1,
      };
      saveUndoSnapshot();
      setMusicTrack(musicClip);
      setEditingMusic((current) => [...current, musicClip]);
      setActiveMusicClipId(musicClip.clipId);
      setSelectionStart(0);
      setSelectionEnd(getClipDuration(musicClip));
      setSpliceError("");
      URL.revokeObjectURL(url);
    } catch (error) {
      setMusicError(error.message);
    } finally {
      setMusicLoading(false);
      event.target.value = "";
    }
  }

  function selectSoundstripeTrack(track) {
    if (!editorEngine) {
      setMusicError("The editor engine is still loading.");
      setShowMusicPicker(false);
      return;
    }

    saveUndoSnapshot();
    const backendTrackIndex = editorEngine.saveSpotifyTrack(
      track.id,
      track.name,
      track.artists,
      track.duration,
      track.url,
    );
    const musicClip = {
      ...track,
      backendTrackIndex,
      sourceStart: 0,
      sourceEnd: track.duration,
      timelineStart: 0,
      clipId: crypto.randomUUID(),
      kind: "music",
      volume: 1,
    };
    setMusicTrack(musicClip);
    setEditingMusic((current) => [...current, musicClip]);
    setActiveMusicClipId(musicClip.clipId);
    setSelectionStart(0);
    setSelectionEnd(getClipDuration(musicClip));
    setSpliceError("");
    setShowMusicPicker(false);
  }

  function handleDragStart(event, video) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-video-url", video.url);
    event.dataTransfer.setData("text/plain", video.url);
  }

  function getDropInsertionIndex(clientX) {
    const clipElements = timelineTrackRef.current
      ? [...timelineTrackRef.current.querySelectorAll("[data-video-clip-id]")]
      : [];
    for (const element of clipElements) {
      const bounds = element.getBoundingClientRect();
      if (clientX < bounds.left + bounds.width / 2) {
        const index = editingVideos.findIndex(
          (video) => video.clipId === element.dataset.videoClipId,
        );
        if (index >= 0) return index;
      }
    }
    return editingVideos.length;
  }

  function getTimelineTimeAtClientX(clientX) {
    if (!timelineTrackRef.current || projectDuration <= 0) return 0;
    const bounds = timelineTrackRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    return timelineStartTime + fraction * projectDuration;
  }

  function findChainedVisualAtTime(timelineTime) {
    let elapsed = 0;
    for (const clip of chainedVisualClips) {
      const duration = getClipDuration(clip);
      if (timelineTime >= elapsed && timelineTime < elapsed + duration) {
        return { clip, start: elapsed };
      }
      elapsed += duration;
    }
    return null;
  }

  function findVisualAtTime(timelineTime) {
    const overlayPhoto = [...floatingPhotos].reverse().find((photo) => (
      timelineTime >= photo.timelineStart
      && timelineTime < photo.timelineStart + getClipDuration(photo)
    ));
    if (overlayPhoto) return { clip: overlayPhoto, start: overlayPhoto.timelineStart };
    return findChainedVisualAtTime(timelineTime);
  }

  function handleUploadedMediaDropCapture(event) {
    if (!event.dataTransfer.types.includes("application/x-video-url")) return;
    event.preventDefault();
    event.stopPropagation();
    handleDrop(event, getDropInsertionIndex(event.clientX));
  }

  function handleDrop(event, requestedInsertionIndex = editingVideos.length) {
    event.preventDefault();
    setIsDraggingOver(false);
    setTimelineDragMode(null);

    if (event.dataTransfer.getData("application/x-timeline-clip-id")) return;
    const photoClipId = event.dataTransfer.getData("application/x-photo-clip-id");
    if (photoClipId) {
      movePhotoToPointer(photoClipId, event.clientX);
      return;
    }
    const musicClipId = event.dataTransfer.getData("application/x-music-clip-id");
    if (musicClipId) {
      moveMusicTrackToPointer(musicClipId, event.clientX);
      return;
    }

    const videoUrl = event.dataTransfer.getData("application/x-video-url")
      || event.dataTransfer.getData("text/plain");
    const droppedVideo = videos.find((video) => video.url === videoUrl);

    if (droppedVideo) {
      if (isPhoto(droppedVideo)) {
        const timelineStart = getTimelineTimeAtClientX(event.clientX);
        const intersection = findChainedVisualAtTime(timelineStart);
        setPendingPhotoDrop({
          photo: droppedVideo,
          insertionIndex: intersection
            ? editingVideos.findIndex((clip) => clip.clipId === intersection.clip.clipId) + 1
            : requestedInsertionIndex,
          timelineStart,
          intersectedClipId: intersection?.clip.clipId ?? null,
        });
        return;
      }
      addMediaClip(droppedVideo, requestedInsertionIndex, droppedVideo.duration);
    }
  }

  function addMediaClip(media, requestedInsertionIndex, duration, timelineStart) {
    const clipDuration = Number.isFinite(duration) && duration > 0
      ? duration
      : DEFAULT_PHOTO_DURATION;
    saveUndoSnapshot();
    const shouldActivateClip = editingVideos.length === 0;
    const clip = {
      ...media,
      duration: clipDuration,
      clipId: crypto.randomUUID(),
      sourceStart: 0,
      sourceEnd: clipDuration,
      volume: 1,
      ...(isPhoto(media) && Number.isFinite(timelineStart) ? { timelineStart } : {}),
    };
    setEditingVideos((current) => [
      ...current.slice(0, requestedInsertionIndex),
      clip,
      ...current.slice(requestedInsertionIndex),
    ]);
    if (shouldActivateClip) {
      setSelectedVideo(clip);
      setActiveClipId(clip.clipId);
      setPlaybackTime(0);
      setSelectionStart(0);
      setSelectionEnd(clipDuration);
      setSpliceError("");
    }
  }

  function confirmPhotoDrop(duration, placement) {
    if (!pendingPhotoDrop) return;
    addMediaClip(
      pendingPhotoDrop.photo,
      pendingPhotoDrop.insertionIndex,
      duration,
      placement === "insert-into" ? pendingPhotoDrop.timelineStart : undefined,
    );
    setPendingPhotoDrop(null);
  }

  function handleTimelineDragStart(event, clipId) {
    event.stopPropagation();
    setDraggedClipId(clipId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-timeline-clip-id", clipId);
  }

  function handleTimelineClipDrop(event, targetClipId) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    setTimelineDragMode(null);

    const draggedClipId = event.dataTransfer.getData("application/x-timeline-clip-id");
    if (!draggedClipId) {
      const targetBounds = event.currentTarget.getBoundingClientRect();
      const targetIndex = editingVideos.findIndex(
        (video) => video.clipId === targetClipId,
      );
      const insertAfter = event.clientX > targetBounds.left + targetBounds.width / 2;
      handleDrop(event, targetIndex + (insertAfter ? 1 : 0));
      return;
    }
    if (draggedClipId === targetClipId) return;

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientX > targetBounds.left + targetBounds.width / 2;
    const draggedClip = editingVideos.find((video) => video.clipId === draggedClipId);
    if (!draggedClip) return;

    const withoutDraggedClip = editingVideos.filter(
      (video) => video.clipId !== draggedClipId,
    );
    const targetIndex = withoutDraggedClip.findIndex(
      (video) => video.clipId === targetClipId,
    );
    if (targetIndex < 0) return;

    const insertionIndex = targetIndex + (insertAfter ? 1 : 0);
    saveUndoSnapshot();
    setEditingVideos([
      ...withoutDraggedClip.slice(0, insertionIndex),
      draggedClip,
      ...withoutDraggedClip.slice(insertionIndex),
    ]);
  }

  function handleVideoTrackDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    setTimelineDragMode(null);
    const clipId = event.dataTransfer.getData("application/x-timeline-clip-id");
    const draggedClip = editingVideos.find((video) => video.clipId === clipId);
    if (!draggedClip) return;

    const remainingClips = editingVideos.filter((video) => video.clipId !== clipId);
    const clipElements = [...event.currentTarget.querySelectorAll("[data-video-clip-id]")]
      .filter((element) => element.dataset.videoClipId !== clipId);
    let insertionIndex = remainingClips.length;
    for (const element of clipElements) {
      const bounds = element.getBoundingClientRect();
      if (event.clientX < bounds.left + bounds.width / 2) {
        insertionIndex = remainingClips.findIndex(
          (video) => video.clipId === element.dataset.videoClipId,
        );
        break;
      }
    }

    saveUndoSnapshot();
    setEditingVideos([
      ...remainingClips.slice(0, insertionIndex),
      draggedClip,
      ...remainingClips.slice(insertionIndex),
    ]);
    setDraggedClipId(null);
  }

  function selectUploadedVideo(video) {
    setSelectedVideo(video);
    setActiveClipId(null);
    setActiveMusicClipId(null);
    setPlaybackTime(0);
    setSelectionStart(0);
    setSelectionEnd(0);
    setSpliceError("");
  }

  function selectTimelineClip(video) {
    continuePlaybackRef.current = false;
    setSelectedVideo(video);
    setActiveClipId(video.clipId);
    setActiveMusicClipId(null);
    setPlaybackTime(0);
    setSelectionStart(0);
    setSelectionEnd(getClipDuration(video));
    setSpliceError("");
  }

  function selectMusicClip(track) {
    const timelineTime = track.timelineStart || 0;
    setUniversalPlaybackTime(timelineTime);
    const visualAtTime = findVisualAtTime(timelineTime);
    const targetVideo = visualAtTime?.clip ?? null;
    const elapsed = visualAtTime?.start ?? 0;

    if (targetVideo) {
      const relativeTime = Math.max(
        0,
        Math.min(getClipDuration(targetVideo), timelineTime - elapsed),
      );
      const sourceTime = (targetVideo.sourceStart || 0) + relativeTime;
      previewRef.current?.pause();
      if (targetVideo.clipId !== activeClipId) {
        pendingSeekRef.current = { clipId: targetVideo.clipId, sourceTime };
        setSelectedVideo(targetVideo);
        setActiveClipId(targetVideo.clipId);
      } else if (previewRef.current) {
        previewRef.current.currentTime = sourceTime;
      }
      setPlaybackTime(relativeTime);
      syncMusicPlayback(timelineTime, false);
    }

    setMusicTrack(track);
    setActiveMusicClipId(track.clipId);
    setSelectionStart(0);
    setSelectionEnd(getClipDuration(track));
    setSpliceError("");
  }

  function updateClipVolume(clipType, clipId, value) {
    const volume = Math.max(0, Math.min(1, Number(value)));
    if (clipType === "video") {
      setEditingVideos((current) => current.map((clip) => (
        clip.clipId === clipId ? { ...clip, volume } : clip
      )));
      if (clipId === activeClipId && previewRef.current) {
        previewRef.current.volume = volume;
      }
      return;
    }

    setEditingMusic((current) => current.map((track) => (
      track.clipId === clipId ? { ...track, volume } : track
    )));
    const audio = musicAudioRefs.current.get(clipId);
    if (audio) audio.volume = volume;
  }

  function handleMusicDragStart(event, clipId) {
    event.stopPropagation();
    const track = editingMusic.find((item) => item.clipId === clipId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const grabFraction = bounds.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
      : 0;
    musicDragOffsetRef.current = track ? grabFraction * getClipDuration(track) : 0;
    setDraggedClipId(clipId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-music-clip-id", clipId);
  }

  function handlePhotoDragStart(event, clipId) {
    event.stopPropagation();
    const photo = editingVideos.find((item) => item.clipId === clipId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const grabFraction = bounds.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
      : 0;
    photoDragOffsetRef.current = photo ? grabFraction * getClipDuration(photo) : 0;
    setDraggedClipId(clipId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-photo-clip-id", clipId);
  }

  function movePhotoToPointer(clipId, clientX) {
    const photo = editingVideos.find((item) => item.clipId === clipId);
    if (!photo || !timelineTrackRef.current) return;

    const pointerTime = getTimelineTimeAtClientX(clientX);
    const duration = getClipDuration(photo);
    const latestStart = Math.max(timelineStartTime, timelineEndTime - duration);
    const timelineStart = Math.max(
      timelineStartTime,
      Math.min(latestStart, pointerTime - photoDragOffsetRef.current),
    );
    saveUndoSnapshot();
    setEditingVideos((current) => current.map((item) => (
      item.clipId === clipId ? { ...item, timelineStart } : item
    )));
    setDraggedClipId(null);
    photoDragOffsetRef.current = 0;
  }

  function handlePhotoTrackDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    setTimelineDragMode(null);
    const clipId = event.dataTransfer.getData("application/x-photo-clip-id");
    if (clipId) movePhotoToPointer(clipId, event.clientX);
  }

  function moveMusicTrackToPointer(clipId, clientX) {
    if (!timelineTrackRef.current) return;
    const track = editingMusic.find((item) => item.clipId === clipId);
    if (!track) return;

    const bounds = timelineTrackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const pointerTime = timelineStartTime + percent * projectDuration;
    const trackDuration = getClipDuration(track);
    const unclampedStart = pointerTime - musicDragOffsetRef.current;
    const timelineStart = Math.max(
      timelineStartTime,
      Math.min(timelineEndTime - trackDuration, unclampedStart),
    );
    saveUndoSnapshot();
    setEditingMusic((current) => current.map((item) => (
      item.clipId === clipId ? { ...item, timelineStart } : item
    )));
    setDraggedClipId(null);
    musicDragOffsetRef.current = 0;
  }

  function handleMusicTrackDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    setTimelineDragMode(null);
    const clipId = event.dataTransfer.getData("application/x-music-clip-id");
    moveMusicTrackToPointer(clipId, event.clientX);
  }

  function handleDurationChange(event) {
    const duration = event.currentTarget.duration;
    if (!Number.isFinite(duration)) return;

    setSelectedVideo((current) => current ? { ...current, duration } : current);
    setVideos((current) => current.map((video) => (
      video.url === selectedVideo?.url ? { ...video, duration } : video
    )));
    setEditingVideos((current) => current.map((video) => (
      video.url === selectedVideo?.url
        ? {
            ...video,
            duration: Number.isFinite(video.sourceEnd)
              ? video.sourceEnd - (video.sourceStart || 0)
              : duration,
            sourceEnd: Number.isFinite(video.sourceEnd) ? video.sourceEnd : duration,
          }
        : video
    )));
  }

  function handleUploadedVideoMetadata(videoUrl, duration) {
    if (!Number.isFinite(duration)) return;
    setVideos((current) => current.map((video) => (
      video.url === videoUrl ? { ...video, duration } : video
    )));
    setSelectedVideo((current) => (
      current?.url === videoUrl ? { ...current, duration } : current
    ));
    setEditingVideos((current) => current.map((video) => (
      video.url === videoUrl && !Number.isFinite(video.sourceEnd)
        ? { ...video, duration, sourceEnd: duration }
        : video
    )));
  }

  function handleUploadedPhotoMetadata(photoUrl, naturalWidth, naturalHeight) {
    if (!naturalWidth || !naturalHeight) return;
    const photoMetadata = {
      naturalWidth,
      naturalHeight,
      aspectRatio: naturalWidth / naturalHeight,
    };
    setVideos((current) => current.map((media) => (
      media.url === photoUrl ? { ...media, ...photoMetadata } : media
    )));
    setSelectedVideo((current) => (
      current?.url === photoUrl ? { ...current, ...photoMetadata } : current
    ));
    setEditingVideos((current) => current.map((media) => (
      media.url === photoUrl ? { ...media, ...photoMetadata } : media
    )));
  }

  function handleClipDuration(clipId, duration) {
    if (!Number.isFinite(duration)) return;
    if (clipId === activeClipId && selectionEnd === 0) {
      setSelectionEnd(duration);
    }
    setEditingVideos((current) => current.map((video) => (
      video.clipId === clipId
        ? {
            ...video,
            duration: Number.isFinite(video.sourceEnd)
              ? video.sourceEnd - (video.sourceStart || 0)
              : duration,
            sourceEnd: Number.isFinite(video.sourceEnd) ? video.sourceEnd : duration,
          }
        : video
    )));
  }

  function advancePlayback() {
    if (activeClipIndex < 0 || activeClipIndex >= editingVideos.length - 1) return;
    continuePlaybackRef.current = true;
    selectTimelineClip(editingVideos[activeClipIndex + 1]);
    continuePlaybackRef.current = true;
  }

  function syncMusicPlayback(timelineTime, shouldPlay) {
    for (const track of editingMusic) {
      const audio = musicAudioRefs.current.get(track.clipId);
      if (!audio) continue;

      const clipStart = track.timelineStart || 0;
      const clipDuration = getClipDuration(track);
      const isInClip = timelineTime >= clipStart
        && timelineTime < clipStart + clipDuration;
      if (!isInClip) {
        audio.pause();
        continue;
      }

      const sourceTime = (track.sourceStart || 0) + timelineTime - clipStart;
      if (Math.abs(audio.currentTime - sourceTime) > 0.5) {
        audio.currentTime = sourceTime;
      }
      audio.playbackRate = previewRef.current?.playbackRate || 1;
      audio.volume = track.volume ?? 1;
      if (shouldPlay && audio.paused && !musicPlayPendingRef.current.has(track.clipId)) {
        musicPlayPendingRef.current.add(track.clipId);
        audio.play()
          .catch(() => {})
          .finally(() => musicPlayPendingRef.current.delete(track.clipId));
      } else {
        if (!shouldPlay) audio.pause();
      }
    }
  }

  function stopTimelineClock(pausePreview = true) {
    timelinePlayingRef.current = false;
    setIsTimelinePlaying(false);
    if (timelineAnimationRef.current) {
      cancelAnimationFrame(timelineAnimationRef.current);
      timelineAnimationRef.current = null;
    }
    if (pausePreview) previewRef.current?.pause();
    syncMusicPlayback(universalPlaybackTime, false);
  }

  function startTimelineClock(startTime = universalPlaybackTime, startPreview = true) {
    if (timelinePlayingRef.current) return;
    const initialTime = startTime >= playbackEndTime ? timelineStartTime : startTime;
    let startedAt;
    let previewStarted = initialTime >= 0 && initialTime < timelineDuration;
    let currentVisualClipId = activeClipId;
    const playbackRate = previewRef.current?.playbackRate || 1;
    timelinePlayingRef.current = true;
    setIsTimelinePlaying(true);
    setUniversalPlaybackTime(initialTime);
    if (startPreview && previewStarted) previewRef.current?.play().catch(() => {});

    const tick = (now) => {
      if (!timelinePlayingRef.current) return;
      startedAt ??= now;
      const nextTime = Math.min(
        playbackEndTime,
        initialTime + ((now - startedAt) / 1000) * playbackRate,
      );
      setUniversalPlaybackTime(nextTime);
      syncMusicPlayback(nextTime, true);
      if (nextTime >= 0 && nextTime < timelineDuration) {
        const visualAtTime = findVisualAtTime(nextTime);
        const targetClip = visualAtTime?.clip ?? null;
        const elapsed = visualAtTime?.start ?? 0;
        if (targetClip) {
          const relativeTime = Math.max(0, nextTime - elapsed);
          if (targetClip.clipId !== currentVisualClipId) {
            preserveTimelineOnPauseRef.current = true;
            previewRef.current?.pause();
            currentVisualClipId = targetClip.clipId;
            setSelectedVideo(targetClip);
            setActiveClipId(targetClip.clipId);
            setActiveMusicClipId(null);
            setSelectionStart(0);
            setSelectionEnd(getClipDuration(targetClip));
            if (!isPhoto(targetClip)) {
              pendingSeekRef.current = {
                clipId: targetClip.clipId,
                sourceTime: (targetClip.sourceStart || 0) + relativeTime,
              };
              continuePlaybackRef.current = true;
            }
          }
          if (isPhoto(targetClip)) setPlaybackTime(relativeTime);
        }
      }
      if (!previewStarted && nextTime >= 0 && nextTime < timelineDuration) {
        previewStarted = true;
        previewRef.current?.play().catch(() => {});
      }
      if (nextTime >= playbackEndTime) {
        stopTimelineClock();
        return;
      }
      timelineAnimationRef.current = requestAnimationFrame(tick);
    };
    timelineAnimationRef.current = requestAnimationFrame(tick);
  }

  function handlePreviewLoadedMetadata(event) {
    handleDurationChange(event);
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek?.clipId === activeClipId) {
      event.currentTarget.currentTime = pendingSeek.sourceTime;
      pendingSeekRef.current = null;
    } else {
      event.currentTarget.currentTime = activeTimelineClip?.sourceStart || 0;
    }
  }

  function handlePreviewTimeUpdate(event) {
    const sourceStart = activeTimelineClip?.sourceStart || 0;
    const relativeTime = Math.max(0, event.currentTarget.currentTime - sourceStart);
    setPlaybackTime(relativeTime);
    if (!timelinePlayingRef.current) {
      const videoTimelineTime = elapsedBeforeActiveClip + relativeTime;
      setUniversalPlaybackTime(videoTimelineTime);
      syncMusicPlayback(videoTimelineTime, !event.currentTarget.paused);
    }

    const sourceEnd = activeTimelineClip?.sourceEnd;
    if (Number.isFinite(sourceEnd) && event.currentTarget.currentTime >= sourceEnd - 0.03) {
      preserveTimelineOnPauseRef.current = timelinePlayingRef.current;
      event.currentTarget.pause();
      advancePlayback();
    }
  }

  function handlePreviewCanPlay() {
    if (!continuePlaybackRef.current) return;
    continuePlaybackRef.current = false;
    previewRef.current?.play().catch(() => {});
  }

  function seekTimelineFromPointer(clientX) {
    if (!editorEngine || !timelineTrackRef.current || projectDuration <= 0) return;

    const trackBounds = timelineTrackRef.current.getBoundingClientRect();
    const pointerPercent = Math.max(
      0,
      Math.min(100, ((clientX - trackBounds.left) / trackBounds.width) * 100),
    );
    const timelineTime = editorEngine.timelineTimeFromPercent(
      projectDuration,
      pointerPercent,
    ) + timelineStartTime;
    setUniversalPlaybackTime(timelineTime);
    syncMusicPlayback(timelineTime, false);

    const visualAtTime = findVisualAtTime(timelineTime);
    const targetClip = visualAtTime?.clip ?? null;
    const elapsed = visualAtTime?.start ?? 0;

    if (!targetClip) return;
    const targetClipDuration = getClipDuration(targetClip);
    const relativeTime = Math.max(0, Math.min(targetClipDuration, timelineTime - elapsed));
    const sourceTime = (targetClip.sourceStart || 0) + relativeTime;
    previewRef.current?.pause();

    if (targetClip.clipId !== activeClipId) {
      pendingSeekRef.current = { clipId: targetClip.clipId, sourceTime };
      setSelectedVideo(targetClip);
      setActiveClipId(targetClip.clipId);
      setActiveMusicClipId(null);
      setSelectionStart(0);
      setSelectionEnd(targetClipDuration);
      setSpliceError("");
    } else if (previewRef.current) {
      previewRef.current.currentTime = sourceTime;
    }
    setPlaybackTime(relativeTime);
  }

  function handlePlayheadPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (timelinePlayingRef.current) stopTimelineClock();
    setIsScrubbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTimelineFromPointer(event.clientX);
  }

  function flashRangeError(message) {
    setSpliceError(message);
    setErrorFlashKey((current) => current + 1);
  }

  function handleRangeChange(boundary, value) {
    const nextValue = Number(value);
    if (boundary === "start") {
      setSelectionStart(nextValue);
      if (nextValue >= selectionEnd) {
        flashRangeError("Select start must be before select end.");
      } else {
        setSpliceError("");
      }
      return;
    }

    setSelectionEnd(nextValue);
    if (nextValue <= selectionStart) {
      flashRangeError("Select end must be after select start.");
    } else {
      setSpliceError("");
    }
  }

  function handleSplice() {
    if (!editorEngine || !activeEditClip) return;

    const sourceStart = activeEditClip.sourceStart || 0;
    const sourceEnd = activeEditClip.sourceEnd ?? activeEditClip.duration;
    const result = editorEngine.spliceRange(
      sourceStart,
      sourceEnd,
      sourceStart + selectionStart,
      sourceStart + selectionEnd,
    );

    if (!result.valid) {
      flashRangeError("Select start must be before select end.");
      return;
    }

    const createRangeClip = (rangeStart, rangeEnd) => ({
      ...activeEditClip,
      clipId: crypto.randomUUID(),
      sourceStart: rangeStart,
      sourceEnd: rangeEnd,
      duration: rangeEnd - rangeStart,
      timelineStart: Number.isFinite(activeEditClip.timelineStart)
        ? activeEditClip.timelineStart + (rangeStart - sourceStart)
        : undefined,
    });
    const selectedClip = createRangeClip(result.selectionStart, result.selectionEnd);
    const replacementClips = [
      ...(result.hasBefore
        ? [createRangeClip(result.beforeStart, result.beforeEnd)]
        : []),
      selectedClip,
      ...(result.hasAfter
        ? [createRangeClip(result.afterStart, result.afterEnd)]
        : []),
    ];

    saveUndoSnapshot();
    if (activeMusicClip) {
      setEditingMusic((current) => [
        ...current.slice(0, activeMusicIndex),
        ...replacementClips,
        ...current.slice(activeMusicIndex + 1),
      ]);
      setActiveMusicClipId(selectedClip.clipId);
      setSelectionStart(0);
      setSelectionEnd(getClipDuration(selectedClip));
      setSpliceError("");
      return;
    }
    setEditingVideos((current) => [
      ...current.slice(0, activeClipIndex),
      ...replacementClips,
      ...current.slice(activeClipIndex + 1),
    ]);
    setSelectedVideo(selectedClip);
    setActiveClipId(selectedClip.clipId);
    setPlaybackTime(0);
    setSelectionStart(0);
    setSelectionEnd(getClipDuration(selectedClip));
    setSpliceError("");
  }

  function openClipMenu(event, clipId, clipType = "video") {
    event.preventDefault();
    event.stopPropagation();
    setAppMenu(null);
    setTransitionMenu(null);
    setClipMenu({ clipId, clipType, x: event.clientX, y: event.clientY });
  }

  function openTransitionMenu(event, leftClipId, rightClipId) {
    event.preventDefault();
    event.stopPropagation();
    setClipMenu(null);
    setAppMenu(null);
    setTransitionMenu({
      transitionKey: `${leftClipId}:${rightClipId}`,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openPlayheadMenu(event) {
    if (editingVideos.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setClipMenu(null);
    setTransitionMenu(null);
    setAppMenu(null);
    setPlayheadMenu({ x: event.clientX, y: event.clientY });
  }

  function openTextEditor() {
    if (editingVideos.length === 0) return;
    setTextEditor({ startTime: universalPlaybackTime });
    setPlayheadMenu(null);
  }

  function addTextOverlay({ text, duration, fontFamily, fontSize, color }) {
    if (!textEditor || editingVideos.length === 0) return;
    saveUndoSnapshot();
    setTextOverlays((current) => [...current, {
      id: crypto.randomUUID(),
      text,
      duration,
      timelineStart: textEditor.startTime,
      positionX: 50,
      positionY: 82,
      fontFamily,
      fontSize,
      color,
    }]);
    setTextEditor(null);
  }

  function moveTextOverlay(overlayId, element, clientX, clientY) {
    const stage = element.parentElement;
    if (!stage) return;
    const stageBounds = stage.getBoundingClientRect();
    const overlayBounds = element.getBoundingClientRect();
    const halfWidth = (overlayBounds.width / stageBounds.width) * 50;
    const halfHeight = (overlayBounds.height / stageBounds.height) * 50;
    const positionX = Math.max(
      halfWidth,
      Math.min(100 - halfWidth, ((clientX - stageBounds.left) / stageBounds.width) * 100),
    );
    const positionY = Math.max(
      halfHeight,
      Math.min(100 - halfHeight, ((clientY - stageBounds.top) / stageBounds.height) * 100),
    );
    setTextOverlays((current) => current.map((overlay) => (
      overlay.id === overlayId ? { ...overlay, positionX, positionY } : overlay
    )));
  }

  function openTransitionEditor(transitionKey) {
    setTransitionEditor({
      transitionKey,
      initialTransition: videoTransitions[transitionKey] ?? null,
    });
    setTransitionMenu(null);
  }

  function saveVideoTransition(transition) {
    if (!transitionEditor) return;
    saveUndoSnapshot();
    setVideoTransitions((current) => ({
      ...current,
      [transitionEditor.transitionKey]: transition,
    }));
    setTransitionEditor(null);
  }

  function openAppMenu(event) {
    const interactiveElement = event.target.closest(
      "button, input, select, textarea, video, a, [draggable='true'], [data-context-menu-exempt]",
    );
    if (interactiveElement) return;

    event.preventDefault();
    setClipMenu(null);
    setTransitionMenu(null);
    setPlayheadMenu(null);
    setAppMenu({ x: event.clientX, y: event.clientY });
  }

  function deleteTimelineClip(clipId) {
    const clipIndex = editingVideos.findIndex((video) => video.clipId === clipId);
    if (clipIndex < 0) {
      const musicIndex = editingMusic.findIndex((track) => track.clipId === clipId);
      if (musicIndex < 0) return;

      saveUndoSnapshot();
      if (clipId === activeMusicClipId) {
        const neighboringTrack = editingMusic[musicIndex + 1]
          ?? editingMusic[musicIndex - 1];
        if (neighboringTrack) {
          selectMusicClip(neighboringTrack);
        } else {
          setMusicTrack(null);
          setActiveMusicClipId(null);
          setSelectionStart(0);
          setSelectionEnd(activeTimelineClip ? getClipDuration(activeTimelineClip) : 0);
        }
      }

      setEditingMusic((current) => current.filter((track) => track.clipId !== clipId));
      setClipMenu(null);
      return;
    }

    saveUndoSnapshot();
    const clipTimelineStart = Number.isFinite(editingVideos[clipIndex].timelineStart)
      ? editingVideos[clipIndex].timelineStart
      : editingVideos
        .slice(0, clipIndex)
        .filter((clip) => !(isPhoto(clip) && Number.isFinite(clip.timelineStart)))
        .reduce((total, video) => total + getClipDuration(video), 0);
    const clipTimelineEnd = clipTimelineStart + getClipDuration(editingVideos[clipIndex]);
    const playheadIsInsideClip = universalPlaybackTime >= clipTimelineStart
      && universalPlaybackTime < clipTimelineEnd;
    if (clipId === activeClipId || playheadIsInsideClip) {
      continuePlaybackRef.current = false;
      preserveTimelineOnPauseRef.current = false;
      stopTimelineClock();
    }
    if (editingVideos.length === 1) {
      setTextOverlays([]);
      setTextEditor(null);
      setPlayheadMenu(null);
    }
    if (clipId === activeClipId) {
      const neighboringClip = editingVideos[clipIndex + 1] ?? editingVideos[clipIndex - 1];
      if (neighboringClip) {
        selectTimelineClip(neighboringClip);
      } else {
        setActiveClipId(null);
        setPlaybackTime(0);
        setSelectionStart(0);
        setSelectionEnd(0);
      }
    }

    setEditingVideos((current) => current.filter((video) => video.clipId !== clipId));
    setClipMenu(null);
  }

  function deleteTextOverlay(overlayId) {
    if (!textOverlays.some((overlay) => overlay.id === overlayId)) return;
    saveUndoSnapshot();
    setTextOverlays((current) => current.filter((overlay) => overlay.id !== overlayId));
    setClipMenu(null);
  }

  function startNewProject() {
    if ((videos.length > 0 || editingVideos.length > 0 || editingMusic.length > 0)
      && !window.confirm("Start a new project? Unsaved changes will be cleared.")) {
      return;
    }
    stopTimelineClock();
    videos.forEach((media) => {
      if (media.url?.startsWith("blob:")) URL.revokeObjectURL(media.url);
    });
    for (const audio of musicAudioRefs.current.values()) audio.pause();
    while (editorEngine?.canUndo()) editorEngine.popUndoState();
    setVideos([]);
    setSelectedVideo(null);
    setEditingVideos([]);
    setEditingMusic([]);
    setTextOverlays([]);
    setVideoTransitions({});
    setActiveClipId(null);
    setActiveMusicClipId(null);
    setPlaybackTime(0);
    setUniversalPlaybackTime(0);
    setSelectionStart(0);
    setSelectionEnd(0);
    setMusicTrack(null);
    setSpliceError("");
    setMusicError("");
    setProjectSaveStatus("idle");
    setCanUndo(false);
    setClipMenu(null);
    setTransitionMenu(null);
    setTransitionEditor(null);
    setPlayheadMenu(null);
    setTextEditor(null);
    setAppMenu(null);
    setShowMusicPicker(false);
    setShowProjectLoader(false);
    setPendingPhotoDrop(null);
    pendingSeekRef.current = null;
  }

  async function logOut() {
    stopTimelineClock();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function saveProject() {
    if (savingProjectRef.current) return;
    savingProjectRef.current = true;
    setProjectSaveStatus("saving");
    const serializeVideo = (video) => {
      const serializedVideo = { ...video };
      delete serializedVideo.file;
      if (serializedVideo.url?.startsWith("blob:")) serializedVideo.url = null;
      return serializedVideo;
    };
    try {
      const persistedVideos = await Promise.all(videos.map(async (video) => {
        if (!video.url?.startsWith("blob:")) return serializeVideo(video);
        if (!video.file) throw new Error(`Missing source file for ${video.name}`);
        const uploadResponse = await fetch("/api/video-assets", {
          method: "POST",
          headers: { "Content-Type": video.type || "video/mp4" },
          body: new Uint8Array(await video.file.arrayBuffer()),
        });
        const upload = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(upload.error || "Unable to store video");
        return {
          ...serializeVideo(video),
          url: `${upload.url}?type=${encodeURIComponent(video.type || "video/mp4")}`,
          persistentAssetId: upload.assetId,
        };
      }));
      const persistedByUrl = new Map(
        videos.map((video, index) => [video.url, persistedVideos[index]]),
      );
      const persistedEditingVideos = editingVideos.map((video) => ({
        ...serializeVideo(video),
        ...(persistedByUrl.get(video.url) ?? {}),
        clipId: video.clipId,
        sourceStart: video.sourceStart,
        sourceEnd: video.sourceEnd,
        duration: video.duration,
        volume: video.volume,
      }));
      const response = await fetch("/api/project/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videos: persistedVideos,
          editingVideos: persistedEditingVideos,
          editingMusic,
          textOverlays,
          videoTransitions,
          activeClipId,
          activeMusicClipId,
          universalPlaybackTime,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save project");
      setVideos(persistedVideos);
      setEditingVideos(persistedEditingVideos);
      setSelectedVideo((current) => (
        current
          ? persistedEditingVideos.find((video) => video.clipId === current.clipId)
            ?? persistedByUrl.get(current.url)
            ?? current
          : current
      ));
      setProjectSaveStatus("saved");
    } catch {
      setProjectSaveStatus("error");
    } finally {
      savingProjectRef.current = false;
    }
  }

  async function openProjectLoader() {
    setProjectSaveStatus("idle");
    try {
      const response = await fetch("/api/project/save");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to list projects");
      setSavedProjects(payload.projects ?? []);
      setShowProjectLoader(true);
    } catch {
      setProjectSaveStatus("error");
    }
  }

  async function loadProject(projectId) {
    setLoadingProjectId(projectId);
    try {
      const response = await fetch(`/api/project/save/${projectId}`);
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "Unable to load project");
      stopTimelineClock();
      const loadedVideos = project.videos ?? [];
      const loadedEditingVideos = project.editingVideos ?? [];
      const loadedMusic = project.editingMusic ?? [];
      const savedTimelineTime = Number.isFinite(project.universalPlaybackTime)
        ? project.universalPlaybackTime
        : 0;
      let elapsed = 0;
      let selectedClip = null;
      let selectedClipTime = 0;
      const loadedFloatingPhoto = [...loadedEditingVideos].reverse().find((video) => (
        isPhoto(video)
        && Number.isFinite(video.timelineStart)
        && savedTimelineTime >= video.timelineStart
        && savedTimelineTime < video.timelineStart + getClipDuration(video)
      ));
      if (loadedFloatingPhoto) {
        selectedClip = loadedFloatingPhoto;
        selectedClipTime = savedTimelineTime - loadedFloatingPhoto.timelineStart;
      }
      for (const video of loadedEditingVideos.filter((clip) => !(
        isPhoto(clip) && Number.isFinite(clip.timelineStart)
      ))) {
        if (selectedClip) break;
        const duration = getClipDuration(video);
        if (savedTimelineTime >= elapsed && savedTimelineTime < elapsed + duration) {
          selectedClip = video;
          selectedClipTime = Math.max(0, savedTimelineTime - elapsed);
          break;
        }
        elapsed += duration;
      }
      selectedClip ??= loadedEditingVideos.find(
        (video) => video.clipId === project.activeClipId,
      ) ?? loadedEditingVideos[0] ?? loadedVideos[0] ?? null;
      if (selectedClip?.clipId) {
        pendingSeekRef.current = {
          clipId: selectedClip.clipId,
          sourceTime: (selectedClip.sourceStart || 0) + selectedClipTime,
        };
      }
      setVideos(loadedVideos);
      setEditingVideos(loadedEditingVideos);
      setEditingMusic(loadedMusic);
      setTextOverlays(project.textOverlays ?? []);
      setVideoTransitions(project.videoTransitions ?? {});
      setActiveClipId(selectedClip?.clipId ?? null);
      setActiveMusicClipId(project.activeMusicClipId ?? null);
      setSelectedVideo(selectedClip);
      setMusicTrack(
        loadedMusic.find((track) => track.clipId === project.activeMusicClipId)
          ?? loadedMusic[0]
          ?? null,
      );
      setUniversalPlaybackTime(savedTimelineTime);
      setPlaybackTime(selectedClipTime);
      setSelectionStart(0);
      setSelectionEnd(selectedClip ? getClipDuration(selectedClip) : 0);
      setCanUndo(false);
      setShowProjectLoader(false);
      setProjectSaveStatus("loaded");
    } catch {
      setProjectSaveStatus("error");
    } finally {
      setLoadingProjectId(null);
    }
  }

  return (
    <div className="app-shell" onContextMenu={openAppMenu}>
      <header className="app-header">
        <h1>Timeline Studio 🎬</h1>
        <div className="header-actions">
          <a
            className="project-patreon-link"
            href="https://patreon.com/JeffreyNg?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
            target="_blank"
            rel="noreferrer"
          >
            Support on Patreon
          </a>
          <button type="button" className="new-project-button" onClick={startNewProject}>
            New project
          </button>
          <button type="button" className="logout-button" onClick={logOut}>
            Log out
          </button>
        </div>
      </header>

      <div className="container">
        <h2 className="uploaded-files">Media</h2>
        <label className="media-upload-button">
          Choose files
          <input
            className="visually-hidden"
            type="file"
            accept="video/*,image/*"
            multiple
            onChange={handleVideoUpload}
          />
        </label>
        <p className="media-helpful-tip">
          💡 Helpful tips: Right-click over elements to see options available.
        </p>
        <div className="project-save-control">
          <button
            type="button"
            className="save-project-button load-project-button"
            onClick={openProjectLoader}
          >
            Load project
          </button>
          <button
            type="button"
            className="save-project-button"
            onClick={saveProject}
            disabled={projectSaveStatus === "saving"}
          >
            {projectSaveStatus === "saving" ? "Saving…" : "Save project"}
          </button>
          {projectSaveStatus === "saved" && <span>Project saved</span>}
          {projectSaveStatus === "loaded" && <span>Project loaded</span>}
          {projectSaveStatus === "error" && <span className="error">Save failed</span>}
        </div>
      </div>
      <div className="uploaded-section">
        <div className="media-workspace">
          <section>
            <h2>Uploaded</h2>
            <div className="preview-row">
              {videos.map((video) => (
                <button
                  key={video.url}
                  type="button"
                  className={`video-item${activeClipId === null && activeMusicClipId === null && selectedVideo?.url === video.url ? " selected" : ""}`}
                  onClick={() => selectUploadedVideo(video)}
                  draggable
                  onDragStart={(event) => handleDragStart(event, video)}
                  onDragEnd={() => {
                    setIsDraggingOver(false);
                    setTimelineDragMode(null);
                  }}
                  aria-label={`Select or drag ${video.name} into the editing area`}
                  aria-pressed={selectedVideo?.url === video.url}
                >
                  <span className="upload-drag-handle" aria-hidden="true">Drag</span>
                  {isPhoto(video) ? (
                    <img
                      src={video.url}
                      alt=""
                      draggable={false}
                      onLoad={(event) => handleUploadedPhotoMetadata(
                        video.url,
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                      )}
                    />
                  ) : (
                    <video
                      src={`${video.url}#t=3`}
                      muted
                      preload="metadata"
                      draggable={false}
                      onLoadedMetadata={(event) => (
                        handleUploadedVideoMetadata(video.url, event.currentTarget.duration)
                      )}
                    />
                  )}
                  <span className="video-label">{video.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="selected-video">
            <div className="preview-heading">
              <h2>Preview</h2>
              <div className="music-control">
                {musicTrack?.source === "soundstripe" && (
                  <span className="selected-music-name" title={musicTrack.name}>
                    {musicTrack.name} · {musicTrack.artists}
                  </span>
                )}
                {musicTrack?.source === "local" && (
                  <span className="selected-music-name" title={musicTrack.name}>
                    {musicTrack.name}
                  </span>
                )}
                <button
                  type="button"
                  className="add-music-button"
                  onClick={handleAddMusic}
                  disabled={musicLoading}
                  title="Add music"
                >
                  <span className="music-icon" aria-hidden="true">♪</span>
                  {musicLoading ? "Loading..." : "Add music"}
                </button>
                <button
                  type="button"
                  className="add-music-button"
                  onClick={() => musicInputRef.current?.click()}
                  title="Choose an audio file"
                >
                  Choose audio
                </button>
                <input
                  ref={musicInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="audio/*"
                  onChange={handleMusicUpload}
                />
              </div>
            </div>
            {musicError && <p className="music-error" role="alert">{musicError}</p>}
            <div className="preview-stage">
              {selectedVideo && isPhoto(selectedVideo) && selectedPhotoIsVisible ? (
                <div className="photo-preview">
                  <img
                    src={selectedVideo.url}
                    alt={selectedVideo.name}
                    draggable={false}
                    style={{ aspectRatio: selectedVideo.aspectRatio || "auto" }}
                  />
                  {activeClipId && (
                    <button
                      type="button"
                      className="photo-play-button"
                      onClick={() => (
                        isTimelinePlaying ? stopTimelineClock() : startTimelineClock()
                      )}
                    >
                      {isTimelinePlaying ? "Pause" : "Play"}
                    </button>
                  )}
                </div>
              ) : selectedVideo && !isPhoto(selectedVideo) ? (
                <video
                key={`${selectedVideo.url}-${activeClipId ?? "library"}`}
                ref={previewRef}
                src={selectedVideo.url}
                controls
                onCanPlay={handlePreviewCanPlay}
                onDurationChange={handleDurationChange}
                onLoadedMetadata={handlePreviewLoadedMetadata}
                onTimeUpdate={handlePreviewTimeUpdate}
                onSeeked={handlePreviewTimeUpdate}
                onPlay={(event) => {
                  const startTime = universalPlaybackTime;
                  if (startTime < 0 && !timelinePlayingRef.current) {
                    preserveTimelineOnPauseRef.current = true;
                    event.currentTarget.pause();
                  }
                  syncMusicPlayback(startTime, true);
                  startTimelineClock(startTime, false);
                }}
                onPause={(event) => {
                  const preserveTimeline = preserveTimelineOnPauseRef.current;
                  preserveTimelineOnPauseRef.current = false;
                  if (!preserveTimeline && !continuePlaybackRef.current) {
                    syncMusicPlayback(universalPlaybackTime, false);
                  }
                  if (!continuePlaybackRef.current
                    && !preserveTimeline
                    && !event.currentTarget.ended) {
                    stopTimelineClock(false);
                  }
                }}
                onRateChange={(event) => {
                  for (const audio of musicAudioRefs.current.values()) {
                    audio.playbackRate = event.currentTarget.playbackRate;
                  }
                }}
                onEnded={advancePlayback}
                />
              ) : (
                <div className="empty-preview">
                  {selectedVideo && isPhoto(selectedVideo) ? "" : "Select uploaded media"}
                </div>
              )}
              {selectedVideo && (
                <div
                  className="preview-fade-overlay"
                  style={{ backgroundColor: fadeOverlay.color, opacity: fadeOverlay.opacity }}
                  aria-hidden="true"
                />
              )}
              {selectedVideo && activeTextOverlays.map((overlay) => (
                <div
                  className="video-text-overlay"
                  key={overlay.id}
                  style={{
                    left: `${overlay.positionX ?? 50}%`,
                    top: `${overlay.positionY ?? 82}%`,
                    color: overlay.color ?? "#ffffff",
                    fontFamily: overlay.fontFamily ?? "Arial, sans-serif",
                    fontSize: `${overlay.fontSize ?? 32}px`,
                  }}
                  role="button"
                  tabIndex="0"
                  aria-label={`Move text: ${overlay.text}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    saveUndoSnapshot();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    moveTextOverlay(
                      overlay.id,
                      event.currentTarget,
                      event.clientX,
                      event.clientY,
                    );
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      moveTextOverlay(
                        overlay.id,
                        event.currentTarget,
                        event.clientX,
                        event.clientY,
                      );
                    }
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                >
                  {overlay.text}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section
          className="editing-section"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="editing-heading">
            <h2>Editing Area</h2>
            <div className={`splice-controls${invalidRange ? " invalid" : ""}`}>
              <button
                type="button"
                className="splice-button"
                onClick={() => {
                  if (isTimelinePlaying) stopTimelineClock();
                  else startTimelineClock();
                }}
                disabled={editingVideos.length === 0 && editingMusic.length === 0}
              >
                {isTimelinePlaying ? "Pause timeline" : "Play timeline"}
              </button>
              <label>
                <span>Select start</span>
                <select
                  value={selectionStart}
                  onChange={(event) => handleRangeChange("start", event.target.value)}
                  disabled={!activeEditClip}
                >
                  {rangeOptions.map((time) => (
                    <option key={`start-${time}`} value={time}>
                      {formatPreciseTime(time)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Select end</span>
                <select
                  value={selectionEnd}
                  onChange={(event) => handleRangeChange("end", event.target.value)}
                  disabled={!activeEditClip}
                >
                  {rangeOptions.map((time) => (
                    <option key={`end-${time}`} value={time}>
                      {formatPreciseTime(time)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="splice-button"
                onClick={handleSplice}
                disabled={!editorEngine || !activeEditClip || invalidRange}
                title="Split the active clip around the selected range"
              >
                Split selection
              </button>
            </div>
          </div>
          {spliceError && (
            <p key={errorFlashKey} className="splice-error flash" role="alert">
              {spliceError}
            </p>
          )}
          <div
            className={`editing-drop-zone${isDraggingOver ? " drag-over" : ""}`}
            onDragEnter={(event) => {
              setIsDraggingOver(true);
              setTimelineDragMode(event.dataTransfer.types.includes(
                "application/x-video-url",
              ) ? "copy" : "move");
            }}
            onDragOverCapture={(event) => {
              if (!event.dataTransfer.types.includes("application/x-video-url")) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "copy";
              setIsDraggingOver(true);
              setTimelineDragMode("copy");
            }}
            onDragOver={(event) => {
              event.preventDefault();
              const isTimelineMove = event.dataTransfer.types.includes(
                "application/x-timeline-clip-id",
              ) || event.dataTransfer.types.includes("application/x-music-clip-id")
                || event.dataTransfer.types.includes("application/x-photo-clip-id");
              event.dataTransfer.dropEffect = isTimelineMove ? "move" : "copy";
              setTimelineDragMode(isTimelineMove ? "move" : "copy");
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsDraggingOver(false);
                setTimelineDragMode(null);
              }
            }}
            onDropCapture={handleUploadedMediaDropCapture}
            onDrop={handleDrop}
          >
            {isDraggingOver && timelineDragMode === "copy" && (
              <div className="timeline-drop-guidance" aria-hidden="true">
                Drop to add media to the timeline
              </div>
            )}
            {(editingVideos.length > 0 || editingMusic.length > 0) && (
              <div
                className="timeline-content"
                ref={timelineTrackRef}
                style={{ width: `${timelineContentWidth}px` }}
              >
                <div
                  className={`timeline-playhead${isScrubbing ? " scrubbing" : ""}`}
                  style={{
                    left: `${playheadPosition}%`,
                    transform: playheadPosition <= 0
                      ? "translateX(0)"
                      : playheadPosition >= 100
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                  }}
                  role="slider"
                  aria-label="Project timeline playhead"
                  aria-valuemin={timelineStartTime}
                  aria-valuemax={timelineEndTime}
                  aria-valuenow={universalPlaybackTime}
                  tabIndex="0"
                  onContextMenu={openPlayheadMenu}
                  onKeyDown={(event) => {
                    if (event.key === "Home" && timelineTrackRef.current) {
                      event.preventDefault();
                      if (timelinePlayingRef.current) stopTimelineClock();
                      seekTimelineFromPointer(
                        timelineTrackRef.current.getBoundingClientRect().left,
                      );
                    }
                  }}
                  onPointerDown={handlePlayheadPointerDown}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      seekTimelineFromPointer(event.clientX);
                    }
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    setIsScrubbing(false);
                  }}
                  onPointerCancel={() => setIsScrubbing(false)}
                  onLostPointerCapture={() => setIsScrubbing(false)}
                />
                <div
                  className="timeline-ruler"
                  onPointerDown={(event) => {
                    if (timelinePlayingRef.current) stopTimelineClock();
                    seekTimelineFromPointer(event.clientX);
                  }}
                >
                  {timelineSecondTicks.map((time) => (
                    <i
                      key={`second-${time}`}
                      className={time % 10 === 0 ? "major" : undefined}
                      style={{
                        left: `${((time - timelineStartTime) / projectDuration) * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  ))}
                  {timelineTicks.map((time) => (
                    <span
                      key={time}
                      className={time === timelineStartTime ? "first" : undefined}
                      style={{
                        left: `${((time - timelineStartTime) / projectDuration) * 100}%`,
                        transform: time === timelineStartTime
                          ? "translateX(0)"
                          : "translateX(-50%)",
                      }}
                    >
                      {formatTimelineTime(time)}
                    </span>
                  ))}
                </div>
                {editingVideos.length > 0 && (
                  <div className="timeline">
                    <div
                      className="editing-track"
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes(
                          "application/x-timeline-clip-id",
                        )) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={handleVideoTrackDrop}
                    >
                  {chainedVisualClips.map((video, index) => {
                    const nextVideo = chainedVisualClips[index + 1];
                    const transitionKey = nextVideo
                      ? `${video.clipId}:${nextVideo.clipId}`
                      : null;
                    const boundaryTime = chainedVisualClips
                      .slice(0, index + 1)
                      .reduce((total, clip) => total + getClipDuration(clip), 0);
                    return (
                    <Fragment key={video.clipId}>
                    <div
                      className={`editing-clip${activeMusicClipId === null && activeClipId === video.clipId ? " active" : ""}${draggedClipId === video.clipId ? " dragging" : ""}`}
                      key={video.clipId}
                      data-video-clip-id={video.clipId}
                      style={{
                        width: `${(getClipDuration(video) / projectDuration) * 100}%`,
                        marginLeft: index === 0
                          ? `${((-timelineStartTime) / projectDuration) * 100}%`
                          : 0,
                      }}
                      onClick={() => selectTimelineClip(video)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectTimelineClip(video);
                        }
                      }}
                      onContextMenu={(event) => openClipMenu(event, video.clipId)}
                      draggable
                      role="button"
                      tabIndex="0"
                      onDragStart={(event) => handleTimelineDragStart(event, video.clipId)}
                      onDragEnd={() => setDraggedClipId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleTimelineClipDrop(event, video.clipId)}
                      aria-label={`Edit ${video.name}`}
                    >
                      <span className="drag-handle" aria-hidden="true">Drag</span>
                      {isPhoto(video) ? (
                        <img
                          src={video.url}
                          alt=""
                          draggable={false}
                          style={{ aspectRatio: video.aspectRatio || "auto" }}
                        />
                      ) : (
                        <video
                          src={`${video.url}#t=${video.sourceStart || 0.01}`}
                          muted
                          preload="metadata"
                          draggable={false}
                          onLoadedMetadata={(event) => (
                            handleClipDuration(video.clipId, event.currentTarget.duration)
                          )}
                        />
                      )}
                      <span title={video.name}>{video.name}</span>
                      <small>{formatTime(getClipDuration(video))}</small>
                      {!isPhoto(video) && (
                      <label className="clip-volume" title="Adjust video volume">
                        <span>Vol</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={video.volume ?? 1}
                          aria-label={`${video.name} volume`}
                          draggable={false}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            saveUndoSnapshot();
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => (
                            updateClipVolume("video", video.clipId, event.target.value)
                          )}
                        />
                      </label>
                      )}
                    </div>
                    {nextVideo && (
                      <div
                        className={`video-transition-slot${videoTransitions[transitionKey] ? " active" : ""}`}
                        style={{
                          left: `${((boundaryTime - timelineStartTime) / projectDuration) * 100}%`,
                        }}
                        data-context-menu-exempt
                        onContextMenu={(event) => (
                          openTransitionMenu(event, video.clipId, nextVideo.clipId)
                        )}
                        title={videoTransitions[transitionKey]
                          ? `${videoTransitions[transitionKey].type} transition, ${videoTransitions[transitionKey].duration} seconds`
                          : "Right-click to add transition"}
                        aria-label={videoTransitions[transitionKey]
                          ? "Crossfade transition"
                          : "Transition slot"}
                      />
                    )}
                    </Fragment>
                    );
                  })}
                    </div>
                  </div>
                )}
                {floatingPhotos.length > 0 && (
                  <div
                    className="photo-track-row"
                    aria-label="Positioned photo track"
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("application/x-photo-clip-id")) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={handlePhotoTrackDrop}
                  >
                    {floatingPhotos.map((photo) => (
                      <div
                        className={`photo-timeline-clip${activeMusicClipId === null && activeClipId === photo.clipId ? " active" : ""}${draggedClipId === photo.clipId ? " dragging" : ""}`}
                        key={photo.clipId}
                        style={{
                          left: `${((photo.timelineStart - timelineStartTime) / projectDuration) * 100}%`,
                          width: `${(getClipDuration(photo) / projectDuration) * 100}%`,
                        }}
                        role="button"
                        tabIndex="0"
                        draggable
                        onClick={() => selectTimelineClip(photo)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectTimelineClip(photo);
                          }
                        }}
                        onContextMenu={(event) => openClipMenu(event, photo.clipId)}
                        onDragStart={(event) => handlePhotoDragStart(event, photo.clipId)}
                        onDragEnd={() => {
                          setDraggedClipId(null);
                          photoDragOffsetRef.current = 0;
                        }}
                        aria-label={`Move ${photo.name} on the timeline`}
                      >
                        <img src={photo.url} alt="" draggable={false} />
                        <span title={photo.name}>{photo.name}</span>
                        <small>{formatTime(getClipDuration(photo))}</small>
                      </div>
                    ))}
                  </div>
                )}
                {editingMusic.length > 0 && (
                  <div className="music-tracks" aria-label="Music tracks">
                    {editingMusic.map((track, index) => (
                      <div
                        className="music-track-row"
                        aria-label={`Music track ${index + 1}`}
                        key={track.clipId}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={handleMusicTrackDrop}
                      >
                      <div
                        className={`music-timeline-clip${activeMusicClipId === track.clipId ? " active" : ""}${draggedClipId === track.clipId ? " dragging" : ""}`}
                        style={{
                          left: `${(((track.timelineStart || 0) - timelineStartTime) / projectDuration) * 100}%`,
                          width: `${(getClipDuration(track) / projectDuration) * 100}%`,
                        }}
                        draggable
                        onClick={() => selectMusicClip(track)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectMusicClip(track);
                          }
                        }}
                        role="button"
                        tabIndex="0"
                        onContextMenu={(event) => (
                          openClipMenu(event, track.clipId, "music")
                        )}
                        onDragStart={(event) => handleMusicDragStart(event, track.clipId)}
                        onDragEnd={() => {
                          setDraggedClipId(null);
                          musicDragOffsetRef.current = 0;
                        }}
                      >
                        <span className="drag-handle" aria-hidden="true">Drag</span>
                        <strong title={track.name}>{track.name}</strong>
                        <span title={track.artists}>{track.artists}</span>
                        <small>{formatTime(getClipDuration(track))}</small>
                        <label className="clip-volume" title="Adjust music volume">
                          <span>Volume</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={track.volume ?? 1}
                            aria-label={`${track.name} volume`}
                            draggable={false}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              saveUndoSnapshot();
                            }}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => (
                              updateClipVolume("music", track.clipId, event.target.value)
                            )}
                          />
                        </label>
                      </div>
                      </div>
                    ))}
                  </div>
                )}
                {editingVideos.length > 0 && textOverlays.length > 0 && (
                  <div className="text-track-row" aria-label="Text track">
                    {textOverlays.map((overlay) => (
                      <div
                        className="text-timeline-clip"
                        key={overlay.id}
                        data-context-menu-exempt
                        style={{
                          left: `${((overlay.timelineStart - timelineStartTime) / projectDuration) * 100}%`,
                          width: `${(overlay.duration / projectDuration) * 100}%`,
                        }}
                        data-full-text={overlay.text}
                        aria-label={`${overlay.text}, ${overlay.duration} seconds`}
                        onContextMenu={(event) => openClipMenu(event, overlay.id, "text")}
                      >
                        <span>{overlay.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                </div>
            )}
            {editingMusic.filter((track) => (
              track.source === "local" || track.source === "soundstripe"
            )).map((track) => (
              <audio
                key={`audio-${track.clipId}`}
                ref={(element) => {
                  if (element) {
                    musicAudioRefs.current.set(track.clipId, element);
                  } else {
                    musicAudioRefs.current.delete(track.clipId);
                  }
                }}
                className="timeline-audio"
                src={track.url}
                preload="auto"
              />
            ))}
            {editingVideos.length === 0 && editingMusic.length === 0 && (
              <p>Drag uploaded videos here</p>
            )}
          </div>
        </section>
        {clipMenu && (
          <div
            className="clip-context-menu"
            style={{ left: clipMenu.x, top: clipMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="danger"
              role="menuitem"
              onClick={() => (
                clipMenu.clipType === "text"
                  ? deleteTextOverlay(clipMenu.clipId)
                  : deleteTimelineClip(clipMenu.clipId)
              )}
            >
              Delete {clipMenu.clipType === "music"
                ? "music section"
                : clipMenu.clipType === "text" ? "text" : "clip"}
            </button>
          </div>
        )}
        {transitionMenu && (
          <div
            className="clip-context-menu"
            style={{ left: transitionMenu.x, top: transitionMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openTransitionEditor(transitionMenu.transitionKey)}
            >
              {videoTransitions[transitionMenu.transitionKey]
                ? "Edit transition"
                : "Add transition"}
            </button>
          </div>
        )}
        {playheadMenu && editingVideos.length > 0 && (
          <div
            className="clip-context-menu"
            style={{ left: playheadMenu.x, top: playheadMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={openTextEditor}>
              Add text
            </button>
          </div>
        )}
        {appMenu && (
          <div
            className="clip-context-menu"
            style={{ left: appMenu.x, top: appMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={undoPreviousEdit}
              disabled={!canUndo}
            >
              Undo previous edit
            </button>
          </div>
        )}
        {showMusicPicker && (
          <MusicPickerModal
            tracks={soundstripeTracks}
            onSelect={selectSoundstripeTrack}
            onClose={() => setShowMusicPicker(false)}
          />
        )}
        {transitionEditor && (
          <AddTransitionModal
            initialTransition={transitionEditor.initialTransition}
            onConfirm={saveVideoTransition}
            onClose={() => setTransitionEditor(null)}
          />
        )}
        {textEditor && editingVideos.length > 0 && (
          <AddTextModal
            startTime={textEditor.startTime}
            onConfirm={addTextOverlay}
            onClose={() => setTextEditor(null)}
          />
        )}
        {showProjectLoader && (
          <LoadProjectModal
            projects={savedProjects}
            loadingId={loadingProjectId}
            onLoad={loadProject}
            onClose={() => setShowProjectLoader(false)}
          />
        )}
        {pendingPhotoDrop && (
          <PhotoDurationModal
            photoName={pendingPhotoDrop.photo.name}
            defaultDuration={pendingPhotoDrop.photo.duration || DEFAULT_PHOTO_DURATION}
            showPlacementOptions={Boolean(pendingPhotoDrop.intersectedClipId)}
            onConfirm={confirmPhotoDrop}
            onClose={() => setPendingPhotoDrop(null)}
          />
        )}
      </div>
    </div>);
}

export default App;
