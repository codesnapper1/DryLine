import type { DecisionFrame, ProviderStatus, SessionConfig, SessionCreateResponse, WeatherResponse } from "./types";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:8000";

export async function createSession(config: SessionConfig): Promise<SessionCreateResponse> {
  const res = await fetch(`${API_BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return res.json();
}

export async function postFrame(sessionId: string, image: Blob, t: number): Promise<DecisionFrame> {
  const form = new FormData();
  form.append("image", image, "frame.jpg");
  form.append("t", String(t));
  const res = await fetch(`${API_BASE}/session/${sessionId}/frame`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`postFrame failed: ${res.status}`);
  return res.json();
}

export function exportCsvUrl(sessionId: string): string {
  return `${API_BASE}/session/${sessionId}/export.csv`;
}

export async function getProviders(): Promise<{ providers: ProviderStatus[]; any_configured: boolean }> {
  const res = await fetch(`${API_BASE}/providers`);
  if (!res.ok) throw new Error(`getProviders failed: ${res.status}`);
  return res.json();
}

export async function selectProvider(provider: string | null): Promise<{ providers: ProviderStatus[] }> {
  const res = await fetch(`${API_BASE}/providers/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) throw new Error(`selectProvider failed: ${res.status}`);
  return res.json();
}

export async function getSummary(sessionId: string): Promise<{ summary: string }> {
  const res = await fetch(`${API_BASE}/session/${sessionId}/summary`);
  if (!res.ok) throw new Error(`getSummary failed: ${res.status}`);
  return res.json();
}

export async function getWeather(sessionId: string): Promise<WeatherResponse> {
  const res = await fetch(`${API_BASE}/session/${sessionId}/weather`);
  if (!res.ok) throw new Error(`getWeather failed: ${res.status}`);
  return res.json();
}

// Synthetic textured mid-luminance frame, used to drive auto-play without a
// real camera/upload. Mirrors backend/scripts/gen_dummy_frame.py: needs real
// texture and mid brightness or roi.py's confidence gate rejects it as
// blurry/out-of-range.
export async function genPlaceholderFrameBlob(size = { w: 480, h: 320 }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size.w, size.h);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const v = 90 + Math.random() * 80;
    imageData.data[i] = v;
    imageData.data[i + 1] = v;
    imageData.data[i + 2] = v;
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9);
  });
}

export async function listPrecomputed(): Promise<{ clips: string[] }> {
  const res = await fetch(`${API_BASE}/precomputed`);
  if (!res.ok) throw new Error(`listPrecomputed failed: ${res.status}`);
  return res.json();
}

export async function getPrecomputedSeries(clipName: string): Promise<{ id: string; frames: DecisionFrame[] }> {
  const res = await fetch(`${API_BASE}/precomputed/${clipName}`);
  if (!res.ok) throw new Error(`getPrecomputedSeries failed: ${res.status}`);
  return res.json();
}

export async function postBaselineFrame(sessionId: string, image: Blob, t: number): Promise<{ label: string }> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("image", image, "frame.jpg");
  form.append("t", String(t));
  const res = await fetch(`${API_BASE}/baseline/frame`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`postBaselineFrame failed: ${res.status}`);
  return res.json();
}

export async function calibrateRoi(
  sessionId: string,
  roiLine: [number, number, number, number],
  roiOffLine: [number, number, number, number]
): Promise<{ roi_boxes: { line: [number, number, number, number]; off_line: [number, number, number, number] } }> {
  const res = await fetch(`${API_BASE}/session/${sessionId}/roi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roi_line: roiLine, roi_off_line: roiOffLine }),
  });
  if (!res.ok) throw new Error(`calibrateRoi failed: ${res.status}`);
  return res.json();
}

export async function postVideo(
  sessionId: string,
  video: File,
  fpsSample = 2.0,
  onProgress?: (pct: number) => void,
): Promise<{ frames_ingested: number; t_start: number; t_end: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", video, video.name);
    form.append("fps_sample", String(fpsSample));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/session/${sessionId}/video`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`postVideo failed: ${xhr.status} ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("postVideo network error"));
    xhr.send(form);
  });
}

export function exportSessionUrl(sessionId: string): string {
  return `${API_BASE}/session/${sessionId}/export`;
}

export function datasetZipUrl(sessionId: string): string {
  return `${API_BASE}/session/${sessionId}/dataset.zip`;
}

export async function getDatasetStats(sessionId: string): Promise<{
  exists: boolean;
  total_frames?: number;
  line_crops?: number;
  off_line_crops?: number;
  label_distribution?: Record<string, number>;
}> {
  const res = await fetch(`${API_BASE}/session/${sessionId}/dataset/stats`);
  if (!res.ok) throw new Error(`getDatasetStats failed: ${res.status}`);
  return res.json();
}
