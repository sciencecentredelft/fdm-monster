import { z } from "zod";
import { minFloorNameLength } from "@/constants/service.constants";
import { idRuleV2 } from "@/controllers/validation/generic.validation";
export const xValidator = z.number().int().min(0).max(12);
export const yValidator = z.number().int().min(0).max(12);
export const floorOrderValidator = z.number().int();
export const floorNameValidator = z.string().min(minFloorNameLength);
const gridPassword = z
  .string()
  .min(8)
  .max(72)
  .refine(
    (value) => value.trim().length >= 8 && Buffer.byteLength(value, "utf8") <= 72,
    "Use at least 8 non-padding characters and at most 72 UTF-8 bytes",
  );

export const floorGridPasswordSchema = z.object({ password: gridPassword.nullable() }).strict();
export const floorGridUnlockSchema = z
  .object({
    password: z
      .string()
      .min(1)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  })
  .strict();

export const printerInFloorSchema = z.object({
  printerId: idRuleV2,
  floorId: idRuleV2,
  x: xValidator,
  y: yValidator,
});

export const updateFloorNameSchema = z.object({
  name: floorNameValidator,
});

export const updateFloorOrderSchema = z.object({
  order: floorOrderValidator,
});

export const createOrUpdateFloorSchema = z.object({
  name: floorNameValidator,
  order: floorOrderValidator,
  printers: z
    .array(
      z.object({
        printerId: idRuleV2,
        floorId: idRuleV2.optional(),
        x: xValidator,
        y: yValidator,
      }),
    )
    .optional(),
});
