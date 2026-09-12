// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * The console's component kit.
 *
 * One component per job. A variant is a prop, not a new component, and before
 * writing one here, check that none of these already covers it — the fastest
 * way to lose a design system is two components that nearly agree.
 *
 * Nothing outside this folder should re-implement a control. If a feature needs
 * something this kit does not have, it goes in here first.
 */

export * from "./avatar";
export * from "./button";
export * from "./callout";
export * from "./card";
export * from "./checkbox";
export * from "./confirm";
export * from "./dialog";
export * from "./feedback";
export * from "./field";
export * from "./input";
export * from "./list";
export * from "./menu";
export * from "./page";
export * from "./segmented";
export * from "./select";
export * from "./separator";
export * from "./status";
export * from "./table";
export * from "./toast";
export * from "./tooltip";
