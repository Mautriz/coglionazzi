import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { rpc } from "~/lib/rpcClient";
import { cn } from "~/lib/classUtils";
import { dragHasFiles, rejectionMessage, triageFiles } from "~/lib/fileDrop";

/** What `rpc.file.upload` hands back for one stored file. */
export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  type: string;
}

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

/** The one upload path: triage on the client, then send the survivors to
 *  `rpc.file.upload` ONE AT A TIME (the endpoint takes a single file per
 *  call). Shared by the button and the drop zone so they cannot drift —
 *  same size cap, same accept rules, same toasts, same cache invalidation.
 *
 *  Uploads are sequential rather than parallel: a drop of twenty files should
 *  not open twenty concurrent requests, and the failure report is simpler. */
export function useFileUpload({
  accept,
  onUploaded,
}: {
  accept?: string;
  onUploaded?: (file: UploadedFile) => void;
}) {
  const queryClient = useQueryClient();
  const [isUploading, setUploading] = useState(false);
  const { mutateAsync } = useMutation(rpc.file.upload.mutationOptions());

  /** `onUploaded` is usually an inline arrow, so a re-render would otherwise
   *  give us a new `uploadFiles` on every render and retrigger effects. */
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  });

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const { accepted, rejected } = triageFiles(files, accept);
      const skipped = rejectionMessage(rejected);
      if (skipped) toast.error(skipped);
      if (accepted.length === 0) return;

      setUploading(true);
      let uploaded = 0;
      try {
        for (const file of accepted) {
          try {
            const result = await mutateAsync({ file });
            uploaded += 1;
            onUploadedRef.current?.(result);
          } catch (err) {
            toast.error(
              `Couldn't upload ${file.name}${
                err instanceof Error ? ` — ${err.message}` : ""
              }`,
            );
          }
        }
      } finally {
        setUploading(false);
        // Invalidate once at the end, not once per file.
        if (uploaded > 0) {
          queryClient.invalidateQueries({ queryKey: rpc.file.mine.key() });
          toast.success(
            uploaded === 1 ? "File uploaded" : `${uploaded} files uploaded`,
          );
        }
      }
    },
    [accept, mutateAsync, queryClient],
  );

  return { uploadFiles, isUploading };
}

/** Generic "pick a file and upload it" button around rpc.file.upload.
 *  Reused by the demo page and card attachments. Any file type is accepted
 *  (the 20MB cap is the only limit) — pass `accept` only where the feature
 *  genuinely needs one kind of file (e.g. deck images).
 *
 *  Kept alongside <FileDropZone> rather than replaced by it: dragging is a
 *  desktop affordance, and touch users need a button. */
export function UploadButton({
  onUploaded,
  size = "default",
  accept,
}: {
  onUploaded?: (file: UploadedFile) => void;
  size?: "default" | "sm";
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles, isUploading } = useFileUpload({ accept, onUploaded });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    void uploadFiles(picked);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        // Picking several at once now works too, since uploadFiles loops.
        multiple
        className="hidden"
        onChange={onPick}
      />
      <Button
        type="button"
        size={size}
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        {isUploading ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <UploadIcon />
        )}
        Upload file
      </Button>
    </>
  );
}

/** Stop a file dropped ANYWHERE else in the window from navigating the tab to
 *  it — the browser's default, and a nasty way to lose unsaved work when a
 *  drop misses its target by a few pixels. Registered once for the whole app,
 *  by the first drop zone that mounts. */
let strayDropGuards = 0;
function useStrayDropGuard() {
  useEffect(() => {
    if (strayDropGuards++ === 0) {
      window.addEventListener("dragover", preventFileDrop);
      window.addEventListener("drop", preventFileDrop);
    }
    return () => {
      if (--strayDropGuards === 0) {
        window.removeEventListener("dragover", preventFileDrop);
        window.removeEventListener("drop", preventFileDrop);
      }
    };
  }, []);
}

function preventFileDrop(event: DragEvent) {
  if (dragHasFiles(event.dataTransfer)) event.preventDefault();
}

/** Wrap any area to make it accept dropped files. Renders its children
 *  normally and overlays a highlight while a file is over it.
 *
 *  Drag events fire per child element, so entering a child looks like leaving
 *  the parent; the usual counter keeps the highlight steady across the whole
 *  subtree. Non-file drags (text, links, a @dnd-kit kanban card) are ignored
 *  so the overlay never flashes during a board drag. */
export function FileDropZone({
  onUploaded,
  accept,
  disabled = false,
  label = "Drop to upload",
  className,
  children,
}: {
  onUploaded?: (file: UploadedFile) => void;
  accept?: string;
  disabled?: boolean;
  /** Overlay text — say what will happen with the file, e.g. "Drop images". */
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { uploadFiles, isUploading } = useFileUpload({ accept, onUploaded });
  const [isOver, setOver] = useState(false);
  const depth = useRef(0);
  useStrayDropGuard();

  if (disabled) return <div className={className}>{children}</div>;

  const reset = () => {
    depth.current = 0;
    setOver(false);
  };

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        // Required, or the browser refuses the drop.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        reset();
        void uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}

      {(isOver || isUploading) && (
        <div
          // Never intercept the pointer: the drop must land on the zone
          // itself, and a stale overlay must not block clicks.
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 backdrop-blur-[1px]"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-primary">
            {isUploading ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <UploadIcon className="size-4" />
                {label}
              </>
            )}
          </span>
        </div>
      )}
    </div>
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
    <FileDropZone className="flex flex-col gap-4" label="Drop files to upload">
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
        <p className="rounded-lg border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground">
          Nothing here yet — drop files here, or use the button. Memes,
          spreadsheets and PDFs all welcome.
        </p>
      )}
    </FileDropZone>
  );
}
