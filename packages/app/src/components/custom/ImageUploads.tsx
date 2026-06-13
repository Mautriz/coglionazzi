import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { rpc } from "~/lib/rpcClient";

/** Generic image upload + gallery of the caller's images. Click a thumbnail
 *  to copy its public URL (servable anywhere, e.g. <img src>). */
export function ImageUploads() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: images } = useQuery(rpc.image.mine.queryOptions());

  const { mutate: upload, isPending } = useMutation(
    rpc.image.upload.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: rpc.image.mine.key() });
        toast.success("Image uploaded");
      },
    }),
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (file) upload({ file });
    e.currentTarget.value = "";
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(
      new URL(url, window.location.origin).toString(),
    );
    toast("URL copied to clipboard");
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={onPick}
      />
      <div>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <ImagePlusIcon />
          )}
          Upload image
        </Button>
      </div>

      {images?.length ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              title="Click to copy URL"
              onClick={() => copyUrl(img.url)}
              className="group relative aspect-square overflow-hidden rounded-md border border-card-border bg-card-background"
            >
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — upload your finest reaction images.
        </p>
      )}
    </div>
  );
}
