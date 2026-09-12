// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { toast as sonner } from "sonner";

/**
 * Transient confirmation of something the person just did.
 *
 * Re-exported through the kit so features never import the toast library
 * directly — swapping it later is then one file, not forty.
 *
 * Not for state already visible on screen: a run that turns green in the list
 * does not also need a toast saying so.
 */
export const toast = {
  success: (message: string) => sonner.success(message),
  error: (message: string) => sonner.error(message),
  info: (message: string) => sonner(message),
};
