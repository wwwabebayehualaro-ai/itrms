// The installed slices. Empty until the first module; task 0.6a loads them from their manifests.
import type { DynamicModule, Type } from '@nestjs/common';

export const SLICES: (Type | DynamicModule)[] = [];
