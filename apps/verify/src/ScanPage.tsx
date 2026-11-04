'use client';

/**
 * The verifier (ADR-0046, task 0.23c): a police officer, an insurer or another office scans a document's QR here, also in flight
 * mode. What it reads is checked on the phone and is never opened as an address, so a fake QR can't lead to a fake page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { refreshKeys, storedKeys, type KnownKeys } from './keys';
import { readFrame, readPhoto } from './qr-reader';
import { lookUp } from './lookup';
import { dayOf, Frame, useLanguage, type Language, type Words } from './shared';
import { examine, type Verdict } from './verdict';
import { VerdictView } from './VerdictView';

const FRAME_EVERY_MS = 300;

const addisDayOf = (instant: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date(instant));

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
            {words['verify.scan.ready'].replace('{day}', dayOf(addisDayOf(known.updatedAt), language))}
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
    const [problem, setProblem] = useState<'noCamera' | 'noCode' | null>(null);
    const [checking, setChecking] = useState(false);
    const [verdict, setVerdict] = useState<Verdict | null>(null);
    const video = useRef<HTMLVideoElement>(null);

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
        if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(() => setCached(true));
    }, [refresh, remember]);

    const check = useCallback(
        async (text: string) => {
            setProblem(null);
            setChecking(true);
            setVerdict(
                await examine(text, {
                    keys: () => knownRef.current?.keys ?? [],
                    refresh: async () => (await refresh())?.keys ?? null,
                    lookUp: (token) => lookUp(token)
                })
            );
            setChecking(false);
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
            const text = await readFrame(video.current).catch(() => null);
            if (stopped) return;
            if (text) {
                setScanning(false);
                await check(text);
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
        setVerdict(null);
        setScanning(false);
        const text = await readPhoto(file);
        if (text) await check(text);
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
            {!checking && verdict && <VerdictView verdict={verdict} words={words} language={language} />}
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
                        setProblem(null);
                        setVerdict(null);
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
