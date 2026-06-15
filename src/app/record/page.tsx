"use client";

import { useRouter } from "next/navigation";
import AudioRecorder from "@/components/AudioRecorder";

export default function RecordPage() {
  const router = useRouter();

  return (
    <div className="flex-1 p-6 max-w-2xl mx-auto w-full overflow-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        Record Audio
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8">
        Record a voice memo and we&apos;ll transcribe it for you. You can then
        comment, highlight, and chat with the transcript just like a PDF.
      </p>

      <AudioRecorder
        onUploadComplete={(recordingId) => {
          router.push(`/recording/${recordingId}`);
        }}
      />
    </div>
  );
}
