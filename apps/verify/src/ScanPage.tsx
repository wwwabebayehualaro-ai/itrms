'use client';

/**
 * The verifier (ADR-0046, task 0.23c): a police officer, an insurer or another office scans a document's QR here, also in flight
 * mode. What it reads is checked on the phone and is never opened as an address, so a fake QR can't lead to a fake page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { addisToday } from '@itrms/documents/contracts/verification-check';

import { refreshKeys, storedKeys, type KnownKeys } from './keys';
import { lookUp } from './lookup';
import { loadReader, readFrame, readPhoto } from './qr-reader';
import { dayOf, Frame, useLanguage, type Language, type Words } from './shared';
import { examine, type Verdict } from './verdict';
import { VerdictView } from './VerdictView';

const FRAME_EVERY_MS = 300;

type Problem = 'noCamera' | 'noCode' | 'noReader' | 'cannotCheck';

function Readiness({
    known,
    cached,
    words,
    language
}: {
    known: KnownKeys | null;
    cached: boolean;
    words: Words;
    language: Language;
}) {
    if (!known || !cached)
        return (
            <p className="hint" data-keys="none">
                {words['verify.scan.notReady']}
            </p>
        );
    return (
        <p className="hint" data-keys="ready">
            {words['verify.scan.ready'].replace('{day}', dayOf(addisToday(new Date(known.updatedAt)), language))}
        </p>
    );
}

export function ScanPage() {
    const { language, words, other } = useLanguage();
    const [known, setKnown] = useState<KnownKeys | null>(null);
    // the promise "works without a connection" is kept only once the service worker has cached the whole app
    const [cached, setCached] = useState(false);
    const knownRef = useRef<KnownKeys | null>(null);
    const [scanning, setScanning] = useState(false);
    const [problem, setProblem] = useState<Problem | null>(null);
    const [checking, setChecking] = useState(false);
    const [verdict, setVerdict] = useState<Verdict | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    // the scan the page is showing: on a slow link an earlier one must not overwrite the document now in hand
    const latest = useRef(0);

    const remember = useCallback((next: KnownKeys | null) => {
        knownRef.current = next;
        setKnown(next);
    }, []);

    const refresh = useCallback(async () => {
        const fresh = await refreshKeys();
        if (fresh) remember(fresh);
        return fresh;
    }, [remember]);

    useEffect(() => {
        void Promise.resolve(storedKeys()).then((stored) => {
            remember(stored);
            return refresh();
        });
        // loaded now, while there may be a connection; a failure here shows when a scan needs it
        loadReader().catch(() => undefined);
        if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(() => setCached(true));
    }, [refresh, remember]);

    /** A new scan: whatever was on the screen, or on its way, is no longer about the document in hand. */
    const begin = useCallback(() => {
        latest.current += 1;
        setProblem(null);
        setVerdict(null);
        setChecking(false);
        return latest.current;
    }, []);

    const check = useCallback(
        async (text: string, scan: number) => {
            const current = () => scan === latest.current;
            setChecking(true);
            try {
                const result = await examine(text, {
                    keys: () => knownRef.current?.keys ?? [],
                    refresh: async () => (await refresh())?.keys ?? null,
                    lookUp: (token) => lookUp(token)
                });
                if (current()) setVerdict(result);
            } catch {
                // the check itself could not run on this phone, which says nothing about the document
                if (current()) setProblem('cannotCheck');
            } finally {
                if (current()) setChecking(false);
            }
        },
        [refresh]
    );

    useEffect(() => {
        if (!scanning) return;
        let stream: MediaStream | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        const look = async () => {
            if (stopped || !video.current) return;
            let text: string | null;
            try {
                text = await readFrame(video.current);
            } catch {
                if (!stopped) {
                    setProblem('noReader');
                    setScanning(false);
                }
                return;
            }
            if (stopped) return;
            if (text) {
                setScanning(false);
                await check(text, latest.current);
                return;
            }
            timer = setTimeout(() => void look(), FRAME_EVERY_MS);
        };
        const open = async () => {
            try {
                const opened = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
                    audio: false
                });
                if (stopped || !video.current) {
                    opened.getTracks().forEach((track) => track.stop());
                    return;
                }
                stream = opened;
                video.current.srcObject = opened;
                await video.current.play();
                void look();
            } catch {
                if (stopped) return;
                setProblem('noCamera');
                setScanning(false);
            }
        };
        void open();
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            stream?.getTracks().forEach((track) => track.stop());
        };
    }, [check, scanning]);

    const onPhoto = async (file: File | undefined) => {
        if (!file) return;
        const scan = begin();
        setScanning(false);
        let text: string | null;
        try {
            text = await readPhoto(file);
        } catch {
            if (scan === latest.current) setProblem('noReader');
            return;
        }
        if (scan !== latest.current) return;
        if (text) await check(text, scan);
        else setProblem('noCode');
    };

    return (
        <Frame language={language} words={words} other={other} title={words['verify.scan.title']}>
            <Readiness known={known} cached={cached} words={words} language={language} />
            {checking && (
                <p className="status status-loading" role="status" data-verdict="checking">
                    {words['verify.page.state.loading']}
                </p>
            )}
            {!checking && verdict && (
                <VerdictView verdict={verdict} documents={known?.documents} words={words} language={language} />
            )}
            {problem && (
                <p className="status status-offline" role="alert" data-problem={problem}>
                    {words[`verify.scan.${problem}`]}
                </p>
            )}
            {scanning && <video ref={video} className="camera" muted playsInline data-camera />}
            <div className="actions">
                <button
                    type="button"
                    data-scan
                    onClick={() => {
                        begin();
                        setScanning(!scanning);
                    }}
                >
                    {scanning
                        ? words['verify.scan.stop']
                        : verdict
                          ? words['verify.scan.again']
                          : words['verify.scan.start']}
                </button>
                <label className="button">
                    {words['verify.scan.photo']}
                    <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        data-photo
                        onChange={(event) => {
                            void onPhoto(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                </label>
            </div>
        </Frame>
    );
}
