import { z } from "zod";
import { validateInput } from "@/handlers/validators";

export const assignedToSchema = z.string().trim().min(1).max(100);
export const assignedEmailSchema = z.string().trim().max(320).optional();

export async function validatePrintAssignment(
  enabled: boolean,
  value: unknown,
  email?: unknown,
): Promise<{ assignedTo: string; assignedEmail: string | null } | undefined> {
  if (!enabled) return undefined;
  return {
    assignedTo: await validateInput(value, assignedToSchema),
    assignedEmail: (await validateInput(email ?? "", assignedEmailSchema)) || null,
  };
}
