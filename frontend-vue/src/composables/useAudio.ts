import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'

interface AudioRecording {
  blob: Blob | null
  duration: number
  isRecording: boolean
  isPlaying: boolean
  currentTime: number
}

// Global audio state to ensure singleton behavior
let audioSystemInitialized = false
let soundsLoaded = false
let globalAudioContext: AudioContext | null = null
let globalSoundBuffers = new Map<string, AudioBuffer>()
let globalWaterSounds: AudioBuffer[] = []
let globalSentSounds: AudioBuffer[] = []

export function useAudio() {
  const appStore = useAppStore()
  
  // Audio Context (use global instance)
  const audioContext = ref<AudioContext | null>(globalAudioContext)
  
  // Sound buffers (use global arrays)
  const soundBuffers = ref<Map<string, AudioBuffer>>(globalSoundBuffers)
  const waterSounds = ref<AudioBuffer[]>(globalWaterSounds)
  const sentSounds = ref<AudioBuffer[]>(globalSentSounds)
  
  // Recording state
  const recording = ref<AudioRecording>({
    blob: null,
    duration: 0,
    isRecording: false,
    isPlaying: false,
    currentTime: 0
  })
  
  // Media recorder
  let mediaRecorder: MediaRecorder | null = null
  let recordingChunks: Blob[] = []
  let recordingStartTime: number = 0
  let recordingInterval: number | null = null

  // Initialize audio context
  const initAudioContext = async () => {
    if (!globalAudioContext) {
      globalAudioContext = new AudioContext()
      audioContext.value = globalAudioContext
    }

    if (globalAudioContext.state === 'suspended') {
      try {
        await globalAudioContext.resume()
      } catch (error) {
        console.warn('AudioContext resume failed, user interaction required:', error)
      }
    }

    // Play a silent buffer to truly unlock AudioContext on iOS PWA
    // On iOS, resume() alone is insufficient — audio must be routed through the context during a user gesture
    if (globalAudioContext.state === 'running') {
      try {
        const silentBuffer = globalAudioContext.createBuffer(1, 1, 22050)
        const source = globalAudioContext.createBufferSource()
        source.buffer = silentBuffer
        source.connect(globalAudioContext.destination)
        source.start(0)
      } catch (error) {
        console.warn('Silent buffer unlock failed:', error)
      }
    }
  }

  // Load a single sound file
  const loadSound = async (url: string): Promise<AudioBuffer | null> => {
    try {
      if (!audioContext.value) {
        await initAudioContext()
      }
      
      if (!audioContext.value) {
        // AudioContext creation failed (probably no user interaction yet)
        return null
      }
      
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      return await audioContext.value.decodeAudioData(arrayBuffer)
    } catch (error) {
      console.warn(`Failed to load sound ${url}:`, error)
      return null
    }
  }

  // Load all sound files
  const loadAllSounds = async () => {
    if (soundsLoaded) {
      console.log('Sounds already loaded, skipping...')
      return
    }
    
    try {
      console.log('Starting to load all sounds...')

      // Load basic sounds
      const basicSounds = {
        intro: '/sounds/intro.wav',
        login: '/sounds/login.wav', 
        copy: '/sounds/copy.wav',
        uploadFailed: '/sounds/uploadfail.wav'
      }

      for (const [name, url] of Object.entries(basicSounds)) {
        const buffer = await loadSound(url)
        if (buffer) {
          globalSoundBuffers.set(name, buffer)
          soundBuffers.value.set(name, buffer)
        }
      }

      // Load water sounds (1-10)
      console.log('Loading water sounds...')
      for (let i = 1; i <= 10; i++) {
        const buffer = await loadSound(`/sounds/water${i}.wav`)
        if (buffer) {
          globalWaterSounds.push(buffer)
          waterSounds.value.push(buffer)
          console.log(`Loaded water sound ${i}`)
        } else {
          console.warn(`Failed to load water sound ${i}`)
        }
      }
      console.log(`Water sounds loaded: ${globalWaterSounds.length}/10, reactive: ${waterSounds.value.length}/10`)

      // Load sent sounds (1-6)  
      for (let i = 1; i <= 6; i++) {
        const buffer = await loadSound(`/sounds/sent${i}.wav`)
        if (buffer) {
          globalSentSounds.push(buffer)
          sentSounds.value.push(buffer)
        }
      }

      soundsLoaded = true
      console.log('All sounds loaded and ready to play')
    } catch (error) {
      console.error('Error loading sounds:', error)
      // Don't set soundsLoaded so a retry can happen on next play attempt
    }
  }

  // Play a sound buffer
  const playSoundBuffer = async (buffer: AudioBuffer) => {
    if (!appStore.settings.soundEnabled) return

    try {
      await initAudioContext()
      if (!globalAudioContext) {
        console.error('AudioContext not initialized')
        return
      }

      // If AudioContext exists but sounds never loaded successfully, retry
      if (!soundsLoaded) {
        await loadAllSounds()
      }

      const source = globalAudioContext.createBufferSource()
      source.buffer = buffer
      source.connect(globalAudioContext.destination)
      source.start(0)
    } catch (error) {
      console.error('Error playing sound:', error)
    }
  }

  // Play specific sounds
  const playSound = async (name: string) => {
    const buffer = globalSoundBuffers.get(name)
    if (buffer) {
      await playSoundBuffer(buffer)
    } else {
      console.warn(`Sound ${name} not loaded`)
    }
  }

  const playWater = async () => {
    console.log(`playWater called - global: ${globalWaterSounds.length}, reactive: ${waterSounds.value.length} water sounds available`)
    if (globalWaterSounds.length > 0) {
      const randomIndex = Math.floor(Math.random() * globalWaterSounds.length)
      const buffer = globalWaterSounds[randomIndex]
      if (buffer) {
        await playSoundBuffer(buffer)
      }
    } else {
      console.warn('Water sounds not loaded - trying to load them now')
      if (globalAudioContext) {
        await loadAllSounds()
        if (globalWaterSounds.length > 0) {
          const randomIndex = Math.floor(Math.random() * globalWaterSounds.length)
          const buffer = globalWaterSounds[randomIndex]
          if (buffer) {
            await playSoundBuffer(buffer)
          }
        }
      }
    }
  }

  const playSent = async () => {
    if (globalSentSounds.length > 0) {
      const randomIndex = Math.floor(Math.random() * globalSentSounds.length)
      const buffer = globalSentSounds[randomIndex]
      if (buffer) {
        await playSoundBuffer(buffer)
      }
    } else {
      console.warn('Sent sounds not loaded')
    }
  }

  // Voice recording
  const startRecording = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      })

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })

      recordingChunks = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunks.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordingChunks, { type: 'audio/webm;codecs=opus' })
        recording.value.blob = blob
        recording.value.isRecording = false
        
        if (recordingInterval) {
          clearInterval(recordingInterval)
          recordingInterval = null
        }
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      recording.value.isRecording = true
      recording.value.duration = 0
      recordingStartTime = Date.now()

      // Update duration every 100ms
      recordingInterval = window.setInterval(() => {
        recording.value.duration = (Date.now() - recordingStartTime) / 1000
      }, 100)

      return true
    } catch (error) {
      console.error('Failed to start recording:', error)
      recording.value.isRecording = false
      return false
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && recording.value.isRecording) {
      mediaRecorder.stop()
    }
  }

  const playRecording = async () => {
    if (!recording.value.blob) return false

    try {
      const audio = new Audio(URL.createObjectURL(recording.value.blob))
      
      recording.value.isPlaying = true
      recording.value.currentTime = 0
      
      audio.ontimeupdate = () => {
        recording.value.currentTime = audio.currentTime
      }
      
      audio.onended = () => {
        recording.value.isPlaying = false
        recording.value.currentTime = 0
        URL.revokeObjectURL(audio.src)
      }
      
      await audio.play()
      return true
    } catch (error) {
      console.error('Failed to play recording:', error)
      recording.value.isPlaying = false
      return false
    }
  }

  const clearRecording = () => {
    if (recording.value.blob) {
      URL.revokeObjectURL(URL.createObjectURL(recording.value.blob))
    }
    recording.value.blob = null
    recording.value.duration = 0
    recording.value.isPlaying = false
    recording.value.currentTime = 0
  }

  // Computed
  const canRecord = computed(() => {
    return navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  })

  const recordingDurationFormatted = computed(() => {
    const duration = recording.value.duration
    const minutes = Math.floor(duration / 60)
    const seconds = Math.floor(duration % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  })

  // Initialize audio on first user interaction
  const initAudioOnUserGesture = async () => {
    if (!audioContext.value || audioContext.value.state === 'suspended') {
      await initAudioContext()
    }
  }

  // Initialize audio system (only once)
  const initializeAudioSystem = () => {
    if (!audioSystemInitialized) {
      audioSystemInitialized = true
      
      // Set up user gesture listeners to initialize audio and load sounds
      // Include touchstart for iOS PWA standalone mode where it fires before click
      const gestureEvents = ['click', 'keydown', 'touchstart'] as const
      const initializeAudio = async () => {
        // Remove all gesture listeners immediately so this only fires once
        for (const event of gestureEvents) {
          document.removeEventListener(event, initializeAudio)
        }
        console.log('User interaction detected, initializing audio system...')
        await initAudioOnUserGesture()
        await loadAllSounds() // Load sounds after user interaction
        console.log('Audio system initialized')
      }

      for (const event of gestureEvents) {
        document.addEventListener(event, initializeAudio)
      }
    }
  }
  
  // Initialize audio system when composable is first used
  initializeAudioSystem()

  return {
    // State
    recording,
    canRecord,
    recordingDurationFormatted,

    // Audio playback
    playSound,
    playWater,
    playSent,

    // Voice recording
    startRecording,
    stopRecording,
    playRecording,
    clearRecording,

    // Audio context
    initAudioContext
  }
}