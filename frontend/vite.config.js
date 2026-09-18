import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

function soundstripeMusicPlugin(apiKey) {
  const apiBase = 'https://api.soundstripe.com/v1'

  async function soundstripeRequest(resource) {
    const response = await fetch(`${apiBase}${resource}`, {
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: 'application/vnd.api+json',
      },
    })
    if (!response.ok) {
      throw new Error(`Soundstripe request failed (${response.status})`)
    }
    return response.json()
  }

  function normalizeSongs(payload) {
    const included = payload.included ?? []
    const resources = new Map(
      included.map((resource) => [`${resource.type}:${resource.id}`, resource]),
    )
    return included
      .filter((resource) => resource.type === 'songs')
      .map((song) => {
        const artistIds = song.relationships?.artists?.data ?? []
        const audioIds = song.relationships?.audio_files?.data ?? []
        const artists = artistIds
          .map(({ id }) => resources.get(`artists:${id}`)?.attributes?.name)
          .filter(Boolean)
          .join(', ')
        const audioFile = audioIds
          .map(({ id }) => resources.get(`audio_files:${id}`))
          .find((resource) => resource?.attributes?.versions?.mp3)
        if (!audioFile) return null
        return {
          id: song.id,
          name: song.attributes.title,
          artists: artists || 'Soundstripe artist',
          duration: audioFile.attributes.duration || 0,
          source: 'soundstripe',
          url: `/api/soundstripe/audio/${song.id}`,
          licenseProvider: 'Soundstripe',
        }
      })
      .filter(Boolean)
  }

  return {
    name: 'soundstripe-music',
    configureServer(server) {
      server.middlewares.use('/api/soundstripe', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        if (!apiKey) {
          response.statusCode = 503
          response.end(JSON.stringify({
            error: 'Add SOUNDSTRIPE_API_KEY to frontend/.env first.',
          }))
          return
        }

        try {
          const requestUrl = new URL(request.url, 'http://localhost')
          const audioMatch = requestUrl.pathname.match(/^\/audio\/([^/]+)$/)
          if (audioMatch) {
            const song = await soundstripeRequest(`/songs/${encodeURIComponent(audioMatch[1])}`)
            const audioFile = (song.included ?? []).find((resource) => (
              resource.type === 'audio_files' && resource.attributes?.versions?.mp3
            ))
            if (!audioFile) throw new Error('Soundstripe track has no MP3 preview')
            response.statusCode = 302
            response.setHeader('Location', audioFile.attributes.versions.mp3)
            response.end()
            return
          }

          if (requestUrl.pathname !== '/tracks') {
            response.statusCode = 404
            response.end(JSON.stringify({ error: 'Soundstripe route not found' }))
            return
          }
          const playlists = await soundstripeRequest('/playlists?page[size]=4')
          const playlistIds = (playlists.data ?? []).map(({ id }) => id)
          if (playlistIds.length === 0) throw new Error('Soundstripe returned no playlists')
          const playlistResults = await Promise.all(playlistIds.map((playlistId) => (
            soundstripeRequest(
              `/playlists/${playlistId}?include=songs,songs.artists,songs.audio_files&page[size]=40`,
            )
          )))
          const uniqueTracks = new Map()
          playlistResults
            .flatMap(normalizeSongs)
            .forEach((track) => uniqueTracks.set(track.id, track))
          const tracks = [...uniqueTracks.values()].slice(0, 40)
          if (tracks.length === 0) throw new Error('Soundstripe returned no playable tracks')
          response.end(JSON.stringify({ tracks }))
        } catch (error) {
          response.statusCode = 502
          response.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

// Retained temporarily as a migration reference; PostgreSQL-backed routes are proxied below.
// eslint-disable-next-line no-unused-vars
function projectStoragePlugin() {
  const dataDirectory = path.resolve('.video-editor-data')
  const audioDirectory = path.join(dataDirectory, 'audio')
  const videoDirectory = path.join(dataDirectory, 'video')
  const projectsDirectory = path.join(dataDirectory, 'projects')
  const musicFile = path.join(dataDirectory, 'music.json')
  const textFile = path.join(dataDirectory, 'text.json')
  const projectFile = path.join(dataDirectory, 'project.json')

  async function readRequestBody(request, maximumBytes = 200 * 1024 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > maximumBytes) throw new Error('Media file is too large')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async function writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(value, null, 2))
    await rename(temporaryPath, filePath)
  }

  async function readMusicRecords() {
    try {
      return JSON.parse(await readFile(musicFile, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  async function readTextRecords() {
    try {
      return JSON.parse(await readFile(textFile, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  return {
    name: 'video-editor-project-storage',
    async configureServer(server) {
      await mkdir(audioDirectory, { recursive: true })
      await mkdir(videoDirectory, { recursive: true })
      await mkdir(projectsDirectory, { recursive: true })

      server.middlewares.use('/api/video-assets', async (request, response, next) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        if (request.method === 'POST' && requestUrl.pathname === '/') {
          try {
            const bytes = await readRequestBody(request, 1024 * 1024 * 1024)
            const assetId = randomUUID()
            await writeFile(path.join(videoDirectory, assetId), bytes)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({
              assetId,
              size: bytes.length,
              url: `/api/video-assets/${assetId}`,
            }))
          } catch (error) {
            response.statusCode = 400
            response.end(JSON.stringify({ error: error.message }))
          }
          return
        }
        if (request.method === 'GET' && /^\/[a-f0-9-]+$/.test(requestUrl.pathname)) {
          try {
            const bytes = await readFile(path.join(videoDirectory, requestUrl.pathname.slice(1)))
            response.setHeader('Content-Type', requestUrl.searchParams.get('type') || 'video/mp4')
            response.setHeader('Accept-Ranges', 'bytes')
            const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
            if (range) {
              const start = Number(range[1])
              if (!Number.isSafeInteger(start) || start >= bytes.length) {
                response.statusCode = 416
                response.setHeader('Content-Range', `bytes */${bytes.length}`)
                response.end()
                return
              }
              const requestedEnd = range[2] ? Number(range[2]) : bytes.length - 1
              const end = Math.min(requestedEnd, bytes.length - 1)
              if (!Number.isSafeInteger(end) || end < start) {
                response.statusCode = 416
                response.setHeader('Content-Range', `bytes */${bytes.length}`)
                response.end()
                return
              }
              response.statusCode = 206
              response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`)
              response.setHeader('Content-Length', end - start + 1)
              response.end(bytes.subarray(start, end + 1))
              return
            }
            response.setHeader('Content-Length', bytes.length)
            response.end(bytes)
          } catch {
            response.statusCode = 404
            response.end('Video asset not found')
          }
          return
        }
        next()
      })

      server.middlewares.use('/api/audio-assets', async (request, response, next) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        response.setHeader('Access-Control-Allow-Origin', '*')

        if (request.method === 'POST' && requestUrl.pathname === '/') {
          try {
            const bytes = await readRequestBody(request)
            const assetId = randomUUID()
            await writeFile(path.join(audioDirectory, assetId), bytes)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({
              assetId,
              size: bytes.length,
              url: `/api/audio-assets/${assetId}`,
            }))
          } catch (error) {
            response.statusCode = 400
            response.end(JSON.stringify({ error: error.message }))
          }
          return
        }

        if (request.method === 'GET' && /^\/[a-f0-9-]+$/.test(requestUrl.pathname)) {
          try {
            const assetId = requestUrl.pathname.slice(1)
            const bytes = await readFile(path.join(audioDirectory, assetId))
            response.setHeader('Content-Type', requestUrl.searchParams.get('type') || 'audio/mpeg')
            response.end(bytes)
          } catch {
            response.statusCode = 404
            response.end('Audio asset not found')
          }
          return
        }

        next()
      })

      server.middlewares.use('/api/project/music', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        try {
          if (request.method === 'GET') {
            response.end(JSON.stringify({ tracks: await readMusicRecords() }))
            return
          }
          if (request.method === 'POST') {
            const record = JSON.parse((await readRequestBody(request, 1024 * 1024)).toString())
            const records = await readMusicRecords()
            const existingIndex = records.findIndex((track) => track.clipId === record.clipId)
            if (existingIndex >= 0) records[existingIndex] = record
            else records.push(record)
            await writeJsonAtomic(musicFile, records)
            response.end(JSON.stringify({ saved: true }))
            return
          }
          if (request.method === 'PUT') {
            const records = JSON.parse(
              (await readRequestBody(request, 5 * 1024 * 1024)).toString(),
            )
            await writeJsonAtomic(musicFile, records)
            response.end(JSON.stringify({ saved: true }))
            return
          }
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: error.message }))
        }
      })

      server.middlewares.use('/api/project/text', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        try {
          if (request.method === 'GET') {
            response.end(JSON.stringify({ overlays: await readTextRecords() }))
            return
          }
          if (request.method === 'PUT') {
            const overlays = JSON.parse(
              (await readRequestBody(request, 5 * 1024 * 1024)).toString(),
            )
            await writeJsonAtomic(textFile, overlays)
            response.end(JSON.stringify({ saved: true }))
            return
          }
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: error.message }))
        }
      })

      server.middlewares.use('/api/project/save', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        try {
          const requestUrl = new URL(request.url, 'http://localhost')
          if (request.method === 'GET' && requestUrl.pathname === '/') {
            const files = (await readdir(projectsDirectory))
              .filter((file) => file.endsWith('.json'))
            const projects = await Promise.all(files.map(async (file) => {
              const project = JSON.parse(await readFile(path.join(projectsDirectory, file), 'utf8'))
              return {
                id: file.slice(0, -5),
                savedAt: project.savedAt,
                videoCount: project.editingVideos?.length ?? 0,
                musicCount: project.editingMusic?.length ?? 0,
              }
            }))
            try {
              const legacyProject = JSON.parse(await readFile(projectFile, 'utf8'))
              if (!projects.some((project) => project.id === legacyProject.projectId)) {
                projects.push({
                  id: 'latest',
                  savedAt: legacyProject.savedAt,
                  videoCount: legacyProject.editingVideos?.length ?? 0,
                  musicCount: legacyProject.editingMusic?.length ?? 0,
                })
              }
            } catch (error) {
              if (error.code !== 'ENOENT') throw error
            }
            projects.sort((left, right) => (
              (right.savedAt ?? '').localeCompare(left.savedAt ?? '')
            ))
            response.end(JSON.stringify({ projects }))
            return
          }
          if (request.method === 'GET' && requestUrl.pathname === '/latest') {
            response.end(await readFile(projectFile, 'utf8'))
            return
          }
          if (request.method === 'GET' && /^\/[a-f0-9-]+$/.test(requestUrl.pathname)) {
            const project = await readFile(
              path.join(projectsDirectory, `${requestUrl.pathname.slice(1)}.json`),
              'utf8',
            )
            response.end(project)
            return
          }
          if (request.method === 'PUT' && requestUrl.pathname === '/') {
            const project = JSON.parse(
              (await readRequestBody(request, 10 * 1024 * 1024)).toString(),
            )
            const savedAt = new Date().toISOString()
            const projectId = randomUUID()
            const savedProject = { ...project, projectId, savedAt }
            await Promise.all([
              writeJsonAtomic(projectFile, savedProject),
              writeJsonAtomic(path.join(projectsDirectory, `${projectId}.json`), savedProject),
            ])
            response.end(JSON.stringify({ saved: true, projectId, savedAt }))
            return
          }
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      soundstripeMusicPlugin(env.SOUNDSTRIPE_API_KEY),
    ],
    server: {
      proxy: {
        '/api/auth': 'http://127.0.0.1:3001',
        '/api/project': 'http://127.0.0.1:3001',
        '/api/video-assets': 'http://127.0.0.1:3001',
        '/api/audio-assets': 'http://127.0.0.1:3001',
      },
    },
  }
})
