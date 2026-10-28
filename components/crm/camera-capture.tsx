"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type CameraCaptureProps = {
  photo: string | null;
  onChange: (jpegDataUrl: string | null) => void;
};

const MAX_WIDTH = 720;

// Front camera preview with Take photo / Retake. Needs HTTPS (or localhost)
// for the browser to allow camera access. The photo stays in memory until
// the check-in is submitted; nothing is stored on the iPad.
export function CameraCapture({ photo, onChange }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setError("The camera isn't available. Allow camera access for this site in Safari settings, then try again.");
    }
  }, []);

  useEffect(() => {
    if (!photo) void start();
    return stop;
  }, [photo, start, stop]);

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    // Un-mirror: the preview is mirrored like a selfie camera, the saved
    // photo is not.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    onChange(canvas.toDataURL("image/jpeg", 0.82));
    stop();
  }

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-2xl border bg-muted">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        )}
      </div>
      {error ? <p className="text-center text-base text-destructive">{error}</p> : null}
      <div className="flex justify-center gap-3">
        {photo ? (
          <Button type="button" variant="outline" className="h-14 px-8 text-lg" onClick={() => onChange(null)}>
            <RotateCcw className="size-5" /> Retake
          </Button>
        ) : error ? (
          <Button type="button" variant="outline" className="h-14 px-8 text-lg" onClick={() => void start()}>
            Try again
          </Button>
        ) : (
          <Button type="button" className="h-14 px-8 text-lg" onClick={capture}>
            <Camera className="size-5" /> Take photo
          </Button>
        )}
      </div>
    </div>
  );
}
