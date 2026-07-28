import { and, eq } from "drizzle-orm";
import { tasks } from "../db/schema";

export const publishedTaskCondition = (taskId: string) =>
  and(eq(tasks.id, taskId), eq(tasks.is_published, true));

export const publishedTasksCondition = () => eq(tasks.is_published, true);
