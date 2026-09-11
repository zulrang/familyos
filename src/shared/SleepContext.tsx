"use client";

import { createContext } from "react";

export const SleepContext = createContext<(() => void) | undefined>(undefined);
