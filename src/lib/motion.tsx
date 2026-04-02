"use client";

/**
 * Lazy-loaded framer-motion wrapper.
 *
 * Uses framer-motion's built-in code-splitting:
 * - `m` components render as plain HTML immediately (interactive from the start)
 * - Animation features load in the background via LazyMotion
 * - Once loaded, animations kick in seamlessly
 *
 * This keeps the initial JS bundle tiny so the hamburger menu
 * and all interactive elements work instantly on mobile.
 */

export { m as motion, AnimatePresence } from "framer-motion";
