import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { rpc } from "~/lib/rpcClient";
import { cn } from "~/lib/classUtils";

export const UPLOAD_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown,application/zip,audio/mpeg,video/mp4";

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Thumbnail for images, name+size chip for everything else. */
export function FilePreview({
  url,
  metadata,
  className,
}: {
  url: string;
  metadata: { name: string; type: string; size: number };
  className?: string;
}) {
  if (metadata.type.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={metadata.name}
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center",
        className,
      )}
    >
      <FileIcon className="size-6 text-primary" />
      <span className="line-clamp-2 w-full text-[11px] leading-tight break-all text-muted-foreground">
        {metadata.name}
      </span>
      <span className="text-[10px] text-muted-foreground2">
        {formatBytes(metadata.size)}
      </span>
    </div>
  );
}

/** Generic "pick a file and upload it" button around rpc.file.upload.
 *  Reused by the demo page and card attachments. */
export function UploadButton({
  onUploaded,
  size = "default",
}: {
  onUploaded?: (file: {
    id: string;
    url: string;
    name: string;
    type: string;
  }) => void;
  size?: "default" | "sm";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { mutate: upload, isPending } = useMutation(
    rpc.file.upload.mutationOptions({
      onSuccess: (uploaded) => {
        queryClient.invalidateQueries({ queryKey: rpc.file.mine.key() });
        toast.success("File uploaded");
        onUploaded?.(uploaded);
      },
    }),
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (file) upload({ file });
    e.currentTarget.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={onPick}
      />
      <Button
        type="button"
        size={size}
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        {isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        Upload file
      </Button>
    </>
  );
}

/** Upload + gallery of the caller's files. Click an item to copy its URL. */
export function FileUploads() {
  const { data: files } = useQuery(rpc.file.mine.queryOptions());

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(
      new URL(url, window.location.origin).toString(),
    );
    toast("URL copied to clipboard");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <UploadButton />
      </div>

      {files?.length ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              title={`${file.metadata.name} — click to copy URL`}
              onClick={() => copyUrl(file.url)}
              className="group relative aspect-square overflow-hidden rounded-md border border-card-border bg-card-background transition-colors hover:border-primary/40"
            >
              <FilePreview url={file.url} metadata={file.metadata} />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — upload your finest memes and PDFs.
        </p>
      )}
    </div>
  );
}
