import { Dialog } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const DialogRoot = Dialog.Root;
const DialogClose = Dialog.Close;
const DialogTitle = Dialog.Title;
const DialogDescription = Dialog.Description;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <Dialog.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-[16vh] z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0c0c10]/95 shadow-2xl backdrop-blur-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export { DialogRoot as Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle };
