import { type NextRequest, NextResponse } from "next/server"
import { generateObject } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"

// Define the Zod schema for the expected output
const gazeSchema = z.object({
  results: z.array(
    z.object({
      frame: z.number().describe("Frame number (1-indexed)"),
      gaze: z.boolean().describe("True if gaze is directed towards the camera or very near to it, false otherwise"),
      confidence: z
        .number()
        .describe("Confidence score (0-100) for the gaze determination"),
    }),
  ),
})

export async function POST(request: NextRequest) {
  try {
    // Expect frames directly in the request body
    const { frames } = (await request.json()) as { frames: string[] }

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json({ error: "No frames provided for analysis" }, { status: 400 })
    }

    console.log(`Analyzing ${frames.length} frames directly using generateObject`)

    // Prepare the prompt with all frames
    // Ensure frame data is suitable for the prompt (assuming base64 data URLs)
    const framesContent = frames.map((img, idx) => `Frame ${idx + 1}:\n![](${img})`).join("\n\n")

    try {
      // Use generateObject with the schema
      const { object } = await generateObject({
        model: google("gemini-2.5-flash-preview-04-17"),
        schema: gazeSchema,
        prompt: `Your task is to analyze the direction of the person's gaze in each frame. The person is using a device (laptop or smartphone) with a front-facing camera capturing these images. This means if the person is generally making eye contact with the camera, it is on-screen. Determine if their gaze is directed *towards the device's screen/camera* (on-screen = true) or elsewhere (off-screen = false). Facing the camera but with eyes tilted slightly below the camera counts as on-screen as laptop cameras and front facing phone cameras are often mounted above the screen itself. Looking significantly left, right, or up counts as off-screen. For each frame number (1-indexed), provide this true/false determination and a confidence score (0-100). If you cannot see the user's face or eyes, return false as well. If there is no person in the image, return false. Output the results according to the provided schema.\n\n${framesContent}`,
        system:
          "You are a computer vision expert that analyzes gaze direction in images. 'On-screen' means directed towards the camera/device screen.  You output structured JSON conforming to the provided schema.",
      })


      // Return the results array from the object
      return NextResponse.json(object.results)
    } catch (error) {
      console.error("Error calling OpenAI API or generating object:", error)
      // Add more specific error handling if needed based on 'error' type
      return NextResponse.json(
        {
          error:
            "Failed to analyze frames with AI service. Check API key/quota or model output conformity.",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    // Handle potential JSON parsing errors from request.json()
    if (error instanceof SyntaxError) {
      console.error("Error parsing request body:", error)
      return NextResponse.json({ error: "Invalid request body format" }, { status: 400 })
    }
    console.error("Error analyzing frames (outer catch):", error)
    return NextResponse.json({ error: "Failed to analyze frames" }, { status: 500 })
  }
}
