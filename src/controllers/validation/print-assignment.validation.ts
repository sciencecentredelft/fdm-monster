import { z } from "zod";
import { validateInput } from "@/handlers/validators";

export const assignedToSchema = z.string().trim().min(1).max(100);

export async function validatePrintAssignment(enabled: boolean, value: unknown): Promise<string | undefined> {
  if (!enabled) return undefined;
  return validateInput(value, assignedToSchema);
}
