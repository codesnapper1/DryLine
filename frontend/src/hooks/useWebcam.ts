/**
 * useWebcam — manages a browser MediaStream for webcam capture.
 *
 * Returns:
 *   videoRef     — attach to <video> element for live preview
 *   isActive     — true while camera is streaming
 *   error        — error string if getUserMedia failed
 *   start()      — request camera permission and start stream
 *   stop()       — stop the stream and release the camera
 *   captureBlob  — captures the current frame as a JPEG Blob
 */

import { useRef, useState, useCallback } from "react";

export interface WebcamHook {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  captureBlob: () => Promise<Blob | null>;
}

export function useWebcam(): WebcamHook {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsActive(true);
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and try again."
          : err instanceof DOMException && err.name === "NotFoundError"
          ? "No camera found on this device."
          : String(err);
      setError(msg);
      setIsActive(false);
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setError(null);
  }, []);

  const captureBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !isActive) {
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        0.90,
      );
    });
  }, [isActive]);

  return { videoRef, isActive, error, start, stop, captureBlob };
}
