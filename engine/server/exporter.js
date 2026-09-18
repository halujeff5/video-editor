import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { pool } from "./db.js";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

function clipDuration(clip) {
  const duration = Number.isFinite(clip.sourceEnd)
    ? clip.sourceEnd - (clip.sourceStart || 0)
    : clip.duration;
  return Math.max(0, Number(duration) || 0);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

async function hasAudioStream(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe.path, [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
      "-of", "csv=p=0", filePath,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || "Unable to inspect media"));
      else resolve(stdout.trim().length > 0);
    });
  });
}

export async function renderProject({ document, userId, assetDirectory, resolveRemoteAudio }) {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), "timeline-studio-export-"));
  const outputPath = path.join(workDirectory, "timeline-studio.mp4");
  try {
  const visuals = [];
  let chainedStart = 0;

  for (const clip of document.editingVideos || []) {
    const duration = clipDuration(clip);
    if (duration <= 0) continue;
    const floatingPhoto = clip.mediaKind === "image" && Number.isFinite(clip.timelineStart);
    const start = floatingPhoto ? clip.timelineStart : chainedStart;
    visuals.push({ ...clip, exportStart: start, exportDuration: duration });
    if (!floatingPhoto) chainedStart += duration;
  }

  const music = (document.editingMusic || []).map((track) => ({
    ...track,
    exportStart: Number(track.timelineStart) || 0,
    exportDuration: clipDuration(track),
  })).filter((track) => track.exportDuration > 0);
  const starts = [0, ...visuals.map((clip) => clip.exportStart), ...music.map((track) => track.exportStart)];
  const ends = [chainedStart, ...visuals.map((clip) => clip.exportStart + clip.exportDuration),
    ...music.map((track) => track.exportStart + track.exportDuration)];
  const timelineStart = Math.min(...starts);
  const timelineEnd = Math.max(...ends);
  const totalDuration = timelineEnd - timelineStart;
  if (totalDuration <= 0) throw new Error("Add at least one clip before exporting");

  const assetIds = [...new Set([
    ...visuals.map((clip) => clip.persistentAssetId),
    ...music.map((track) => track.persistentAssetId),
  ].filter(Boolean))];
  const assets = assetIds.length > 0
    ? await pool.query(
      "SELECT id, storage_key FROM media_assets WHERE owner_id = $1 AND id = ANY($2::uuid[])",
      [userId, assetIds],
    )
    : { rows: [] };
  const assetPaths = new Map(assets.rows.map((asset) => (
    [asset.id, path.join(assetDirectory, asset.storage_key)]
  )));

  const args = ["-y"];
  const inputs = [];
  for (const clip of visuals) {
    const filePath = assetPaths.get(clip.persistentAssetId);
    if (!filePath) throw new Error(`Save the source file for ${clip.name || "a visual clip"} before exporting`);
    if (clip.mediaKind === "image" || String(clip.type || "").startsWith("image/")) {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", String(clip.exportDuration), "-i", filePath);
      inputs.push({ kind: "visual", clip, filePath, hasAudio: false });
    } else {
      args.push("-ss", String(clip.sourceStart || 0), "-t", String(clip.exportDuration), "-i", filePath);
      inputs.push({ kind: "visual", clip, filePath, hasAudio: await hasAudioStream(filePath) });
    }
  }
  for (const track of music) {
    let filePath = assetPaths.get(track.persistentAssetId);
    if (!filePath && track.source === "soundstripe") {
      filePath = path.join(workDirectory, `soundstripe-${inputs.length}.mp3`);
      await writeFile(filePath, await resolveRemoteAudio(track));
    }
    if (!filePath) throw new Error(`Audio source unavailable for ${track.name || "a music track"}`);
    args.push("-ss", String(track.sourceStart || 0), "-t", String(track.exportDuration), "-i", filePath);
    inputs.push({ kind: "music", track, filePath, hasAudio: true });
  }

  const filters = [`color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${totalDuration}[canvas]`];
  let videoLabel = "canvas";
  const audioLabels = [];
  inputs.forEach((input, index) => {
    if (input.kind === "visual") {
      const { clip } = input;
      const delay = clip.exportStart - timelineStart;
      const end = delay + clip.exportDuration;
      filters.push(
        `[${index}:v:0]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},setsar=1,` +
        `trim=duration=${clip.exportDuration},setpts=PTS-STARTPTS+${delay}/TB[v${index}]`,
      );
      const nextLabel = `layer${index}`;
      filters.push(
        `[${videoLabel}][v${index}]overlay=(W-w)/2:(H-h)/2:eof_action=pass:` +
        `enable='between(t,${delay},${end})'[${nextLabel}]`,
      );
      videoLabel = nextLabel;
      if (input.hasAudio) {
        const audioLabel = `a${index}`;
        filters.push(
          `[${index}:a:0]aresample=48000,atrim=duration=${clip.exportDuration},` +
          `asetpts=PTS-STARTPTS,volume=${Math.max(0, Number(clip.volume ?? 1))},` +
          `adelay=${Math.round(delay * 1000)}:all=1[${audioLabel}]`,
        );
        audioLabels.push(audioLabel);
      }
    } else {
      const { track } = input;
      const delay = track.exportStart - timelineStart;
      const audioLabel = `a${index}`;
      filters.push(
        `[${index}:a:0]aresample=48000,atrim=duration=${track.exportDuration},` +
        `asetpts=PTS-STARTPTS,volume=${Math.max(0, Number(track.volume ?? 1))},` +
        `adelay=${Math.round(delay * 1000)}:all=1[${audioLabel}]`,
      );
      audioLabels.push(audioLabel);
    }
  });
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${totalDuration}[silence]`);
  if (audioLabels.length > 0) {
    filters.push(`[silence]${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length + 1}:duration=first:normalize=0[outa]`);
  } else {
    filters.push("[silence]anull[outa]");
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", "[outa]", "-t", String(totalDuration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath,
  );
  await run(ffmpegPath, args);
  return { outputPath, workDirectory };
  } catch (error) {
    await rm(workDirectory, { recursive: true, force: true });
    throw error;
  }
}
