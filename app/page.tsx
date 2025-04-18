"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Loader2, RefreshCw, Save, CheckCircle, XCircle } from "lucide-react"
import { toast } from "@/components/ui/use-toast"

// Define the results interface locally
interface GazeResult {
  frame: number
  gaze: boolean
  eyesClosed: boolean
  confidence: number
}

export default function GazeRecorder() {
  // Simplified to 2 seconds recording
  const RECORDING_DURATION = 2
  const FRAME_COUNT = 4

  const [recording, setRecording] = useState(false)
  const [count, setCount] = useState(RECORDING_DURATION)
  const [videoURL, setVideoURL] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [capturedFrames, setCapturedFrames] = useState<string[]>([])
  const [analysisResults, setAnalysisResults] = useState<GazeResult[] | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Function to capture a frame from the video stream
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null

    const canvas = canvasRef.current
    const video = videoRef.current
    const ctx = canvas.getContext("2d")

    if (!ctx) return null

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw the current video frame to the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convert to data URL (JPEG with 90% quality)
    return canvas.toDataURL("image/jpeg", 0.9)
  }, [])

  // Start recording and capture frames during recording
  async function startRecording() {
    try {
      // Reset frames and results
      setCapturedFrames([])
      setAnalysisResults(null)
      setVideoURL(null)

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Prioritize front camera
          width: { ideal: 1280 }, // Suggest dimensions
          height: { ideal: 720 },
        },
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      // Set up media recorder for video blob
      mediaRecorder.current = new MediaRecorder(stream, { mimeType: "video/webm" })
      chunks.current = []

      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data)
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: "video/webm" })
        setVideoURL(URL.createObjectURL(blob))
      }

      mediaRecorder.current.start()
      setRecording(true)

      // --- New frame capture logic using setInterval ---
      const frames: string[] = []
      const intervalMs = (RECORDING_DURATION * 1000) / FRAME_COUNT
      let captures = 0

      // Kick off frame grabs in parallel with the recorder
      const grabber = setInterval(() => {
        // Ensure the stream is still active and video is playing
        if (
          !streamRef.current ||
          !videoRef.current ||
          videoRef.current.paused ||
          videoRef.current.ended
        ) {
          console.warn("Stream or video not ready for frame capture, skipping.")
          return
        }

        const frame = captureFrame()
        if (frame) {
          frames.push(frame)
          console.log(`Captured frame ${frames.length}/${FRAME_COUNT}`)
        } else {
          console.warn(`Failed to capture frame ${captures + 1}`)
        }
        captures++
        if (captures >= FRAME_COUNT) {
          clearInterval(grabber)
          console.log("Finished capturing frames via interval.")
        }
      }, intervalMs)

      // --- Separate countdown and stop logic ---
      let currentCount = RECORDING_DURATION
      setCount(currentCount) // Initial count

      const countdownTimer = setInterval(() => {
        currentCount--
        if (currentCount > 0) {
          setCount(currentCount)
        } else {
          // Stop countdown when it reaches 0
          clearInterval(countdownTimer)
        }
      }, 1000) // Update count every second

      // Stop recording and camera after the full duration
      setTimeout(() => {
        clearInterval(countdownTimer) // Ensure countdown stops if not already
        clearInterval(grabber) // Ensure frame grabber stops if not already

        // Stop recording
        if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
          mediaRecorder.current.stop()
          console.log("MediaRecorder stopped.")
        }

        // Stop camera tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => {
            track.stop()
            console.log(`Camera track (${track.kind}) stopped.`)
          })
          streamRef.current = null // Clear the ref
        }

        setRecording(false)
        setCount(RECORDING_DURATION) // Reset count display for next time
        setCapturedFrames(frames) // Set the captured frames state

        console.log(`Finished recording. Captured ${frames.length} frames.`)

        // Optional: Check if the desired number of frames was actually captured
        // (captureFrame might fail sometimes)
        if (frames.length < FRAME_COUNT) {
          toast({
            title: "Warning",
            description: `Attempted to capture ${FRAME_COUNT} frames, but only got ${frames.length}. Analysis might be affected.`,
            variant: "default",
          })
        }
      }, RECORDING_DURATION * 1000)

      // --- Remove the old loop and frame check ---
      // The complex 'for' loop for countdown and frame capture is removed.
      // The 'if (frames.length < FRAME_COUNT)' check after stopping is also removed
      // as the core logic now aims for exactly FRAME_COUNT captures, though we added
      // a check inside the final timeout for robustness.

    } catch (error) {
      console.error("Error starting recording:", error)
      let message = "Unable to access your camera. Please check permissions and try again."
      // Attempt to provide more specific error info
      if (error instanceof Error) {
        message = `Camera Error: ${error.name} - ${error.message}. Check permissions?`
      }
      toast({
        title: "Camera Error",
        description: message,
        variant: "destructive",
      })
      setRecording(false)
    }
  }

  function restart() {
    setVideoURL(null)
    setCount(RECORDING_DURATION)
    setCapturedFrames([])
    setAnalysisResults(null)
  }

  async function analyze() {
    try {
      setLoading(true)

      // If we already have frames from recording, use those
      let frames = capturedFrames

      // If we don't have enough frames, try to extract them from the video as a fallback
      if (frames.length < FRAME_COUNT && videoURL) {
        console.log("Not enough frames captured during recording, attempting extraction from video")
        frames = await extractFramesFromVideo(videoURL, FRAME_COUNT)
      }

      // Validate that we have frames to analyze
      if (!frames || frames.length === 0) {
        throw new Error("No frames captured for analysis")
      }

      console.log(`Analyzing ${frames.length} frames directly`)

      // Call the analysis API directly
      const analyzeResponse = await fetch("/api/gaze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ frames }),
      })

      // Check for HTTP errors in the analysis response
      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json().catch(() => ({})) // Try to get error details
        console.error("Analysis response error:", analyzeResponse.status, analyzeResponse.statusText, errorData)
        throw new Error(
          `Failed to analyze frames: ${analyzeResponse.status} ${analyzeResponse.statusText} - ${errorData.error || "Unknown server error"}`,
        )
      }

      // Parse the analysis response
      let analysisResults
      try {
        analysisResults = await analyzeResponse.json()
      } catch (error) {
        console.error("Failed to parse analysis response:", error)
        throw new Error("Invalid response from analysis service")
      }

      // Validate the analysis response (basic check)
      if (!Array.isArray(analysisResults)) {
        console.error("Invalid analysis response data:", analysisResults)
        throw new Error("Analysis service did not return valid results")
      }

      console.log("Analysis successful, displaying results on the same page")
      // Set the results state instead of navigating
      setAnalysisResults(analysisResults)
      setLoading(false) // Stop loading indicator

    } catch (error) {
      console.error("Error during analysis:", error)
      toast({
        title: "Analysis Error",
        description:
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Failed to analyze. Please try again.",
        variant: "destructive",
      })
      setLoading(false) // Ensure loading is turned off on error
    }
  }

  // Fallback method to extract frames from video blob
  async function extractFramesFromVideo(videoUrl: string, frameCount: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video")
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      const frames: string[] = []

      if (!ctx) {
        reject(new Error("Could not get canvas context"))
        return
      }

      // Set up video element
      video.autoplay = false
      video.muted = true
      video.src = videoUrl

      // Handle errors
      video.onerror = () => {
        reject(new Error("Video loading failed"))
      }

      // Once metadata is loaded, we can access duration
      video.onloadedmetadata = () => {
        console.log(
          `Video metadata loaded. Duration: ${video.duration}s, Size: ${video.videoWidth}x${video.videoHeight}`,
        )

        // Set canvas size
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 360

        // If duration is invalid, use a time-based approach instead
        if (!video.duration || !isFinite(video.duration) || video.duration <= 0) {
          console.warn("Invalid duration, using time-based frame capture")
          captureFramesOverTime()
          return
        }

        // Extract frames at regular intervals
        const frameInterval = video.duration / frameCount
        let framesProcessed = 0

        // Function to capture a single frame at the current time
        const captureVideoFrame = () => {
          try {
            if (!ctx) {
              console.error("Canvas context not available for captureVideoFrame")
              return
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9)
            frames.push(dataUrl)
            console.log(`Captured frame ${frames.length} at time ${video.currentTime}`)
          } catch (e) {
            console.error("Error capturing frame:", e)
          }

          framesProcessed++

          // If we've processed all frames, we're done
          if (framesProcessed >= frameCount) {
            cleanup()
            resolve(frames)
            return
          }

          // Otherwise, seek to the next frame
          const nextTime = framesProcessed * frameInterval
          if (isFinite(nextTime) && nextTime < video.duration) {
            video.currentTime = nextTime
          } else {
            // If we can't seek anymore, we're done
            cleanup()
            resolve(frames)
          }
        }

        // Set up event handlers
        video.onseeked = captureVideoFrame

        // Start the process
        video.currentTime = 0
      }

      // Alternative approach: play the video and capture frames over time
      function captureFramesOverTime() {
        let framesCaptured = 0
        const startTime = Date.now()
        const totalDuration = 2000 // 2 seconds

        video.onplay = () => {
          const captureInterval = setInterval(() => {
            const elapsed = Date.now() - startTime

            // If we've captured enough frames or exceeded the duration, stop
            if (framesCaptured >= frameCount || elapsed >= totalDuration) {
              clearInterval(captureInterval)
              cleanup()
              resolve(frames)
              return
            }

            // Capture a frame
            try {
              if (!ctx) {
                console.error("Canvas context not available for time-based capture")
                return
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              const dataUrl = canvas.toDataURL("image/jpeg", 0.9)
              frames.push(dataUrl)
              framesCaptured++
              console.log(`Time-based capture: frame ${framesCaptured} at ${elapsed}ms`)
            } catch (e) {
              console.error("Error in time-based capture:", e)
            }
          }, totalDuration / frameCount)
        }

        // Start playback
        video.play().catch((e) => {
          console.error("Error playing video:", e)
          reject(e)
        })
      }

      // Clean up resources
      function cleanup() {
        video.pause()
        video.src = ""
        video.load()
      }

      // Load the video
      video.load()
    })
  }

  // Render logic based on whether results exist
  if (analysisResults) {
    // -- RESULTS DISPLAY --
    const onScreenCount = analysisResults.filter((r) => r.gaze).length
    const offScreenCount = analysisResults.length - onScreenCount

    return (
      <div className="container mx-auto py-8 px-4">
        <h1 className="text-3xl font-bold text-center mb-8">Analysis Results</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 max-w-3xl mx-auto">
          <Card>
            <CardHeader><CardTitle>Frames Analyzed</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{analysisResults.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>On-Screen</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-green-600">{onScreenCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Off-Screen</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-600">{offScreenCount}</p></CardContent>
          </Card>
        </div>

        <h2 className="text-2xl font-bold text-center mb-4">Frame Details</h2>
        <div className="space-y-2 max-w-md mx-auto mb-8">
          {analysisResults.map((result) => (
            <div key={result.frame} className="flex items-center justify-between p-2 border rounded">
              <span>Frame {result.frame}</span>
              <div className="flex items-center gap-2">
                {result.gaze ? (
                  <CheckCircle className="size-4 text-green-600" />
                ) : (
                  <XCircle className="size-4 text-red-600" />
                )}
                {result.eyesClosed && <span className="text-xs text-blue-600">(Eyes Closed)</span>}
                <span className="text-sm text-gray-500">({result.confidence.toFixed(0)}%)</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center">
           <Button variant="outline" onClick={restart} disabled={loading}>
             <RefreshCw className="mr-2 size-4" />
             Record Again
           </Button>
        </div>
      </div>
    )
  }

  // -- RECORDER UI --
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6 text-center">Gaze Analysis</h1>
      <p className="text-center mb-8 text-gray-600">
        Record a {RECORDING_DURATION}-second video to analyze your on-screen gaze patterns
      </p>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      <Card className="max-w-md mx-auto">
        <CardContent className="p-6">
          <div className="relative w-full aspect-video bg-gray-100 rounded-md overflow-hidden">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />

            {recording && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                <div className="text-5xl font-bold text-white mb-4">{count}</div>
                <Progress value={((RECORDING_DURATION - count) / RECORDING_DURATION) * 100} className="w-2/3" />
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Loader2 className="size-12 text-white animate-spin" />
              </div>
            )}
          </div>

          {capturedFrames.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-500 mb-2">{capturedFrames.length} frames captured during recording</p>
              <div className="flex gap-1 overflow-x-auto pb-2">
                {capturedFrames.map((frame, i) => (
                  <img
                    key={i}
                    src={frame || "/placeholder.svg"}
                    alt={`Frame ${i + 1}`}
                    className="h-16 w-auto rounded border border-gray-200"
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center gap-4 p-6 pt-0">
          {!videoURL ? (
            <Button onClick={startRecording} disabled={recording || loading} size="lg" className="w-full">
              {recording ? `Recording (${count}s)...` : `Record ${RECORDING_DURATION}s Clip`}
            </Button>
          ) : (
            <div className="flex gap-4 w-full">
              <Button variant="outline" onClick={restart} disabled={loading} className="flex-1">
                <RefreshCw className="mr-2 size-4" />
                Restart
              </Button>
              <Button onClick={analyze} disabled={loading || capturedFrames.length === 0} className="flex-1">
                <Save className="mr-2 size-4" />
                Analyze
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
