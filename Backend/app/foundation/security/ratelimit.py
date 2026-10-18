"""Small in-process sliding-window limiter for brute-force protection (login). Per-process: put a shared limiter
(e.g. Redis) or the API gateway in front when running several replicas."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from app.foundation.errors import TooManyRequests


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            retry = max(1, int(self.window - (now - q[0])))
            raise TooManyRequests("Too many attempts. Try again later.", headers={"Retry-After": str(retry)})
        q.append(now)

    def reset(self) -> None:
        self._hits.clear()
