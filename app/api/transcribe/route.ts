import fs from "fs";
import multiparty from "multiparty";
import { NextRequest, NextResponse } from "next/server";
import { IncomingMessage } from "node:http";
import OpenAI from "openai";
import path from "path";
import { Readable } from "stream";

// Retrieve the OpenAI API key from environment variables
const openaiApiKey = process.env.OPENAI_API_KEY!;

export const config = {
  api: {
    bodyParser: false, // Disable the default body parser to handle multipart form data
  },
};

// Convert Web Stream to Node Stream
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  let result = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const newResult = new Uint8Array(result.length + value.length);
    newResult.set(result);
    newResult.set(value, result.length);
    result = newResult;
  }

  return Buffer.from(result);
}

function toNodeHeaders(headers: Headers): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

class NodeRequest extends Readable {
  headers: { [key: string]: string };
  constructor(body: Buffer, headers: Headers) {
    super();
    this.headers = toNodeHeaders(headers);
    this.push(body);
    this.push(null);
  }
}

async function transcribe(filename: fs.PathLike, apiKey: any) {
  try {
    // different transcriptions for audio and video
    const openai = new OpenAI({ apiKey });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filename),
      model: "whisper-1",
    });
    return transcription;
  } catch (error) {
    console.log("ERROR", error);
  }
}


export async function POST(req: NextRequest) {
  const body = await streamToBuffer(req.body as unknown as ReadableStream<Uint8Array>);
  const nodeReq = new NodeRequest(body, req.headers);

  const form = new multiparty.Form();

  return new Promise((resolve) => {
    console.log("Parsing form data");
    form.parse(nodeReq as unknown as IncomingMessage, async (err, fields, files) => {
      if (err) {
        console.error("Error parsing form data:", err);
        return resolve(new NextResponse(JSON.stringify({ error: "Failed to parse form data" }), { status: 500 }));
      }

      const file = files.file[0];
      const filePath = path.join(process.cwd(), file.originalFilename);

      try {
        const transcription = await transcribe(filePath, openaiApiKey as string);
        console.log("trans: ", transcription);

        return resolve(new NextResponse(JSON.stringify(transcription), { status: 200 }));
      } catch (error) {
        console.error("Error transcribing file:", error);
        return resolve(new NextResponse(JSON.stringify({ error: "Failed to transcribe file" }), { status: 500 }));
      }
    });
  });
}