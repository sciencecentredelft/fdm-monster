import { z } from "zod";

export const startPrintFileSchema = z.object({
  filePath: z.string().min(1),
  assignedTo: z.unknown().optional(),
});

export const downloadFileSchema = z.object({
  path: z.string().min(1),
});

export const getFileSchema = z.object({
  path: z.string().min(1),
});

export const uploadFileSchema = z.object({
  startPrint: z.enum(["true", "false"]),
  assignedTo: z.unknown().optional(),
});

export const getFilesSchema = z.object({
  recursive: z.string().optional(),
  startDir: z.string().optional(),
});
