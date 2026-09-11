import { serve } from "inngest/next";
import { inngest } from "@/jobs/client";
import { functions } from "@/jobs/index";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
