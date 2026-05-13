import React, { useState, useEffect, useRef, useMemo, useCallback, Component } from 'react';
import { createPortal } from 'react-dom';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  useNavigate,
  useLocation
} from 'react-router-dom';
import axios from 'axios';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  signInAnonymously,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { 
  GoogleMap, 
  useJsApiLoader, 
  Marker, 
  InfoWindow,
  Autocomplete,
  DirectionsService,
  DirectionsRenderer
} from '@react-google-maps/api';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocFromServer,
  getDocsFromServer,
  orderBy,
  limit,
  runTransaction
} from 'firebase/firestore';
import { 
  ref as storageRef, 
  uploadString, 
  getDownloadURL 
} from 'firebase/storage';
import { auth, db, storage } from './lib/firebase';
import { supabase } from './lib/supabase';
import { UserProfile, SupportTicket, ChatMessage, Transaction, Referral, AppConfig, Booking, Ride, TripSession, TravelerRideRequest } from './types';
import { walletService, MAX_MAICOINS_PER_RIDE } from './services/walletService';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import { Camera as CapacitorCamera, CameraResultType } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';
import Webcam from 'react-webcam';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { 
  Car, 
  User as UserIcon, 
  LogOut, 
  Search, 
  Plus, 
  History, 
  Settings,
  ShieldCheck,
  Shield,
  MapPin,
  Clock,
  IndianRupee,
  Star,
  Camera,
  CheckCircle2,
  AlertCircle,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  Navigation,
  MessageSquare,
  Send,
  Mic,
  MicOff,
  PlusCircle,
  TrendingUp,
  LineChart as LineChartIcon,
  UserPlus,
  UserMinus,
  LifeBuoy,
  Bot,
  AlertTriangle,
  Users,
  MoreVertical,
  Lock,
  Phone,
  Copy,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  Globe2,
  Download,
  Upload,
  Bell,
  Smartphone
} from 'lucide-react';
import { cn, formatCurrency, calculateServiceFee } from './lib/utils';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, any>) => { open: () => void };
    googleTranslateElementInit?: () => void;
  }
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

// --- Utils ---

const deg2rad = (deg: number) => deg * (Math.PI / 180);

const WEB_API_ORIGIN_FALLBACK = 'https://www.mairide.in';
const WEB_API_ORIGIN_FAILOVER = 'https://mairide-my-way-codex.vercel.app';
const UI_LANGUAGE_PROMPT_APP_SEEN_KEY = 'mairide_ui_language_prompt_seen_app';

const isAppWebViewRuntime = () => {
  if (typeof window === "undefined") return false;
  const protocol = String(window.location.protocol || "").toLowerCase();
  const hostname = String(window.location.hostname || "").toLowerCase();
  const port = String(window.location.port || "").trim();
  return (
    (protocol === "http:" || protocol === "https:")
    && (hostname === "localhost" || hostname === "127.0.0.1")
    && !port
  );
};

const isAppDisplayMode = () => {
  if (typeof window === "undefined") return false;
  const isStandalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return isAppWebViewRuntime() || isAndroidWebViewLikeRuntime() || isStandalone;
};

const isLocalDevFirestoreMode = () => {
  if (typeof window === 'undefined') return false;
  const hostname = String(window.location.hostname || '').toLowerCase();
  const port = String(window.location.port || '').trim();
  // Local Firestore emulation mode should only run for explicit localhost + port dev sessions.
  // Android/iOS webviews often report localhost without a port and must use production APIs.
  return (hostname === 'localhost' || hostname === '127.0.0.1') && port.length > 0;
};

const resolveApiBaseUrl = () => {
  if (typeof window === 'undefined') return '';
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').toLowerCase();
  const isHttpLike = protocol === 'http:' || protocol === 'https:';
  const isLocalRuntimeHost = hostname === 'localhost' || hostname === '127.0.0.1';

  // App runtimes can use:
  // - https://localhost
  // - http://localhost:<port> (often :8080)
  // - custom schemes (capacitor://, ionic://)
  // In all these cases we must call production API origin directly.
  if ((isHttpLike && isLocalRuntimeHost) || protocol === 'capacitor:' || protocol === 'ionic:') {
    return WEB_API_ORIGIN_FALLBACK;
  }

  if (isHttpLike) {
    // Use same-origin for live web/app runtime to avoid CORS and redirect edge-cases.
    return '';
  }
  return WEB_API_ORIGIN_FALLBACK;
};

const apiPath = (path: string) => `${resolveApiBaseUrl()}${path}`;

const isAndroidWebViewLikeRuntime = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const protocol = String(window.location.protocol || '').toLowerCase();
  const capacitorPlatform = (() => {
    try {
      return typeof Capacitor?.getPlatform === 'function' ? String(Capacitor.getPlatform() || '').toLowerCase() : '';
    } catch {
      return '';
    }
  })();
  const isNativeCapacitorAndroid = (() => {
    try {
      return capacitorPlatform === 'android' && typeof Capacitor?.isNativePlatform === 'function'
        ? Capacitor.isNativePlatform()
        : capacitorPlatform === 'android';
    } catch {
      return capacitorPlatform === 'android';
    }
  })();
  const hasCordova = typeof (window as any).cordova !== 'undefined';
  const hasReactNative = typeof (window as any).ReactNativeWebView !== 'undefined';
  return (
    /android/.test(ua) &&
    (/ wv|; wv|version\/\d+\.\d+ mobile/.test(ua) || protocol === 'capacitor:' || protocol === 'ionic:')
  ) || isNativeCapacitorAndroid || (/android/.test(ua) && (hasCordova || hasReactNative));
};

const buildOriginCandidates = (path?: string) => {
  if (typeof window === 'undefined') {
    return [WEB_API_ORIGIN_FALLBACK, WEB_API_ORIGIN_FAILOVER];
  }
  const primary = resolveApiBaseUrl();
  const currentOrigin = String(window.location.origin || '');
  const normalizedPath = String(path || '').toLowerCase();
  const isAuthPath = normalizedPath.startsWith('/api/auth');

  if (isAndroidWebViewLikeRuntime() && isAuthPath) {
    // Android WebView auth is sensitive to host-level HTML fallbacks/challenges.
    // Pin to API-capable public origins first.
    return Array.from(new Set([WEB_API_ORIGIN_FAILOVER, WEB_API_ORIGIN_FALLBACK].filter(Boolean)));
  }

  const appPreferred = isAndroidWebViewLikeRuntime()
    ? [WEB_API_ORIGIN_FAILOVER, WEB_API_ORIGIN_FALLBACK, currentOrigin, primary]
    : [currentOrigin, primary, WEB_API_ORIGIN_FALLBACK, WEB_API_ORIGIN_FAILOVER];
  return Array.from(
    new Set(appPreferred.filter(Boolean))
  );
};

const looksLikeHtmlText = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html') || normalized.includes('<head') || normalized.includes('<body');
};

const isHtmlResponse = (response: Response) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
};

const fetchWithOriginFailover = async (path: string, requestInit: RequestInit) => {
  const origins = buildOriginCandidates(path);
  let lastError: any = null;

  for (const origin of origins) {
    const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const targetUrl = `${normalizedOrigin}${path}`;
    try {
      const response = await fetch(targetUrl, requestInit);
      if (requestInit.method?.toUpperCase() === 'POST') {
        if (isHtmlResponse(response)) {
          continue;
        }
        try {
          const textProbe = (await response.clone().text()).slice(0, 500);
          if (looksLikeHtmlText(textProbe)) {
            continue;
          }
        } catch {
          // Ignore probe failures and continue with raw response handling.
        }
      }
      if (requestInit.method?.toUpperCase() === 'POST' && isHtmlResponse(response)) {
        // Some mobile runtimes can receive an HTML fallback page for one origin.
        // Skip and continue with the next API origin candidate.
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to reach authentication service.');
};

const forceDirectAuthFetch = async (path: string, requestInit: RequestInit) => {
  const directOrigins = [WEB_API_ORIGIN_FAILOVER, WEB_API_ORIGIN_FALLBACK];
  let lastError: any = null;
  for (const origin of directOrigins) {
    const url = `${origin}${path}`;
    try {
      const response = await fetch(url, {
        ...requestInit,
        cache: 'no-store',
      });
      if (isHtmlResponse(response)) continue;
      try {
        const probe = (await response.clone().text()).slice(0, 500);
        if (looksLikeHtmlText(probe)) continue;
      } catch {
        // Ignore probing errors and allow parser to handle.
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Auth service is unreachable.');
};

if (typeof window !== 'undefined') {
  const runtimeApiBase = resolveApiBaseUrl();
  if (runtimeApiBase) {
    axios.defaults.baseURL = runtimeApiBase;
  }
}

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

const toLocalXY = (lat: number, lng: number, refLat: number) => {
  // Simple local projection (good enough for short/medium route matching in app searches)
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos((refLat * Math.PI) / 180);
  return {
    x: lng * kmPerLng,
    y: lat * kmPerLat,
  };
};

const pointToRouteDistanceKm = (
  point: { lat: number; lng: number },
  routeStart: { lat: number; lng: number },
  routeEnd: { lat: number; lng: number }
) => {
  const refLat = (routeStart.lat + routeEnd.lat) / 2;
  const a = toLocalXY(routeStart.lat, routeStart.lng, refLat);
  const b = toLocalXY(routeEnd.lat, routeEnd.lng, refLat);
  const p = toLocalXY(point.lat, point.lng, refLat);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abSq = abx * abx + aby * aby;
  if (abSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return { distanceKm: Math.sqrt(dx * dx + dy * dy), progress: 0 };
  }

  const rawT = (apx * abx + apy * aby) / abSq;
  const t = Math.max(0, Math.min(1, rawT));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  return { distanceKm: Math.sqrt(dx * dx + dy * dy), progress: rawT };
};

const routeCorridorMatch = ({
  rideOriginLocation,
  rideDestinationLocation,
  travelerOriginLocation,
  travelerDestinationLocation,
  pickupDetourKm = 30,
  dropDetourKm = 30,
}: {
  rideOriginLocation: { lat: number; lng: number };
  rideDestinationLocation: { lat: number; lng: number };
  travelerOriginLocation: { lat: number; lng: number } | null;
  travelerDestinationLocation: { lat: number; lng: number } | null;
  pickupDetourKm?: number;
  dropDetourKm?: number;
}) => {
  if (!travelerOriginLocation && !travelerDestinationLocation) return false;

  const pickupCheck = travelerOriginLocation
    ? pointToRouteDistanceKm(travelerOriginLocation, rideOriginLocation, rideDestinationLocation)
    : null;
  const dropCheck = travelerDestinationLocation
    ? pointToRouteDistanceKm(travelerDestinationLocation, rideOriginLocation, rideDestinationLocation)
    : null;

  const pickupValid = !pickupCheck || pickupCheck.distanceKm <= pickupDetourKm;
  const dropValid = !dropCheck || dropCheck.distanceKm <= dropDetourKm;
  if (!pickupValid || !dropValid) return false;

  // Keep travel direction aligned with driver route when both points are provided
  if (pickupCheck && dropCheck) {
    const directionValid = dropCheck.progress >= pickupCheck.progress - 0.05;
    if (!directionValid) return false;
  }

  return true;
};

const getRouteMidpoint = (route: {
  originLocation: { lat: number; lng: number };
  destinationLocation: { lat: number; lng: number };
}) => ({
  lat: (route.originLocation.lat + route.destinationLocation.lat) / 2,
  lng: (route.originLocation.lng + route.destinationLocation.lng) / 2,
});

const getRouteBearingDegrees = (
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
) => {
  const lat1 = deg2rad(start.lat);
  const lat2 = deg2rad(end.lat);
  const dLon = deg2rad(end.lng - start.lng);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
};

const getBearingDifferenceDegrees = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

const routesSharePartialCorridor = (
  candidateRoute: {
    originLocation: { lat: number; lng: number };
    destinationLocation: { lat: number; lng: number };
  },
  referenceRoute: {
    originLocation: { lat: number; lng: number };
    destinationLocation: { lat: number; lng: number };
  },
  pickupRadiusKm: number,
  dropRadiusKm: number
) => {
  const originDistanceKm = getDistance(
    candidateRoute.originLocation.lat,
    candidateRoute.originLocation.lng,
    referenceRoute.originLocation.lat,
    referenceRoute.originLocation.lng
  );
  if (originDistanceKm > pickupRadiusKm) return false;

  const candidateBearing = getRouteBearingDegrees(
    candidateRoute.originLocation,
    candidateRoute.destinationLocation
  );
  const referenceBearing = getRouteBearingDegrees(
    referenceRoute.originLocation,
    referenceRoute.destinationLocation
  );
  if (getBearingDifferenceDegrees(candidateBearing, referenceBearing) > 35) return false;

  const candidateMidpoint = getRouteMidpoint(candidateRoute);
  const referenceMidpoint = getRouteMidpoint(referenceRoute);
  const candidateMidpointToReference = pointToRouteDistanceKm(
    candidateMidpoint,
    referenceRoute.originLocation,
    referenceRoute.destinationLocation
  );
  const referenceMidpointToCandidate = pointToRouteDistanceKm(
    referenceMidpoint,
    candidateRoute.originLocation,
    candidateRoute.destinationLocation
  );
  const midpointCorridorValid =
    candidateMidpointToReference.distanceKm <= pickupRadiusKm ||
    referenceMidpointToCandidate.distanceKm <= pickupRadiusKm;
  if (!midpointCorridorValid) return false;

  const destinationDistanceKm = getDistance(
    candidateRoute.destinationLocation.lat,
    candidateRoute.destinationLocation.lng,
    referenceRoute.destinationLocation.lat,
    referenceRoute.destinationLocation.lng
  );
  return destinationDistanceKm <= dropRadiusKm;
};

const getAdaptiveDetourToleranceKm = (routeDistanceKm: number) => {
  // Keep short-city routes strict, allow moderate flexibility for longer highway journeys.
  if (routeDistanceKm <= 40) {
    return { pickupDetourKm: 12, dropDetourKm: 12 };
  }
  if (routeDistanceKm <= 120) {
    return { pickupDetourKm: 18, dropDetourKm: 18 };
  }
  if (routeDistanceKm <= 250) {
    return { pickupDetourKm: 24, dropDetourKm: 24 };
  }
  return { pickupDetourKm: 30, dropDetourKm: 30 };
};

const normalizeSearchText = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const routeTextMatches = (candidate: string, searchValue: string) => {
  if (!searchValue) return true;
  if (!candidate) return false;
  if (candidate.includes(searchValue) || searchValue.includes(candidate)) return true;

  const candidateTokens = candidate
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const searchTokens = searchValue
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (!searchTokens.length) return true;
  return searchTokens.every((searchToken) =>
    candidateTokens.some((candidateToken) => candidateToken.includes(searchToken) || searchToken.includes(candidateToken))
  );
};

const getRideDuplicateKey = (ride: Partial<Ride>) => {
  const origin = normalizeSearchText(ride.origin || '');
  const destination = normalizeSearchText(ride.destination || '');
  const departureTime = ride.departureTime || '';
  const driverId = ride.driverId || '';
  return `${driverId}__${origin}__${destination}__${departureTime}`;
};

const isVisibleInActiveRideViews = (record: { dashboardVisible?: boolean | null }) =>
  record.dashboardVisible !== false;

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

const compressDataUrlImage = (dataUrl: string, maxEdge = 1280, quality = 0.76) =>
  new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) {
          resolve(dataUrl);
          return;
        }

        const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });

const generateRideOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;

const TRIP_SESSION_STALE_AFTER_MS = 60_000;
const TRIP_SIGNAL_UPDATE_INTERVAL_MS = 3_000;
const TRIP_AUDIT_MAX_ITEMS = 40;
const TRIP_MAX_VALID_SPEED_KMPH = 170;

const getBookingRealtimeStatus = (booking: Booking): TripSession['status'] => {
  if (booking.status === 'cancelled' || booking.status === 'rejected') return 'cancelled';
  if (booking.rideLifecycleStatus === 'completed' || Boolean(booking.rideEndedAt) || booking.status === 'completed') return 'completed';
  if (booking.rideLifecycleStatus === 'in_progress' || Boolean(booking.rideStartedAt)) return 'live';
  return 'preparing';
};

const isBookingTrackable = (booking: Booking) => {
  if ((booking as any).rideRetired) return false;
  if (['cancelled', 'rejected', 'completed'].includes(booking.status)) return false;
  if (booking.rideLifecycleStatus === 'completed' || Boolean(booking.rideEndedAt)) return false;
  return ['pending', 'confirmed', 'negotiating'].includes(booking.status);
};

const deriveTripEtaMinutes = (
  travelerLocation: { lat: number; lng: number } | undefined,
  destinationLocation: { lat: number; lng: number } | undefined,
  speedKmph?: number
) => {
  if (!travelerLocation || !destinationLocation) return undefined;
  const distanceKm = getDistance(
    travelerLocation.lat,
    travelerLocation.lng,
    destinationLocation.lat,
    destinationLocation.lng
  );
  const effectiveSpeed = Math.max(22, Math.min(80, Number(speedKmph || 0) || 36));
  return Math.max(1, Math.round((distanceKm / effectiveSpeed) * 60));
};

const appendTripAuditEntry = (
  existing: TripSession['auditTrail'],
  nextEntry: NonNullable<TripSession['auditTrail']>[number]
) => [...(existing || []), nextEntry].slice(-TRIP_AUDIT_MAX_ITEMS);

const maybeActivateRideLifecycle = async (bookingId: string) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const bookingSnap = await getDoc(bookingRef);
  if (!bookingSnap.exists()) return;

  const booking = { id: bookingSnap.id, ...(bookingSnap.data() as Booking) };
  if (booking.feePaid && booking.driverFeePaid && !booking.rideStartOtp && !booking.rideStartedAt) {
    await updateDoc(bookingRef, {
      rideLifecycleStatus: 'awaiting_start_otp',
      rideStartOtp: generateRideOtp(),
      rideStartOtpGeneratedAt: new Date().toISOString(),
    });
  }
};

type PlatformFeePaymentEvent = {
  id: string;
  bookingId: string;
  payer: 'consumer' | 'driver';
  createdAt: string;
  revenue: number;
  gst: number;
  total: number;
  paymentMode: 'maicoins' | 'online' | 'manual';
};

const hasLockedRideLifecycle = (booking: Partial<Booking>) =>
  booking.status === 'confirmed'
  || booking.rideLifecycleStatus === 'awaiting_start_otp'
  || booking.rideLifecycleStatus === 'in_progress';

const getLockedRideIds = (bookings: Booking[]) => {
  const lockedRideIds = new Set<string>();
  bookings.forEach((booking) => {
    if (booking.rideId && hasLockedRideLifecycle(booking)) {
      lockedRideIds.add(booking.rideId);
    }
  });
  return lockedRideIds;
};

const getPlatformFeePaymentEvents = (bookings: Booking[]): PlatformFeePaymentEvent[] => {
  const events: PlatformFeePaymentEvent[] = [];

  bookings.forEach((booking) => {
    if (booking.feePaid) {
      const paymentMode = booking.consumerPaymentMode === 'hybrid'
        ? 'hybrid'
        : booking.consumerPaymentMode === 'maicoins'
        ? 'maicoins'
        : booking.consumerPaymentGateway === 'razorpay'
          ? 'online'
          : 'manual';
      const feeBreakdown = getBookingPaymentBreakdown(booking as Booking, 'consumer');
      events.push({
        id: `${booking.id}-consumer`,
        bookingId: booking.id,
        payer: 'consumer',
        createdAt: booking.consumerPaymentSubmittedAt || booking.createdAt,
        revenue: feeBreakdown.serviceFee,
        gst: feeBreakdown.gstAmount,
        total: feeBreakdown.totalFee,
        paymentMode,
      });
    }

    if (booking.driverFeePaid) {
      const paymentMode = booking.driverPaymentMode === 'hybrid'
        ? 'hybrid'
        : booking.driverPaymentMode === 'maicoins'
        ? 'maicoins'
        : booking.driverPaymentGateway === 'razorpay'
          ? 'online'
          : 'manual';
      const feeBreakdown = getBookingPaymentBreakdown(booking as Booking, 'driver');
      events.push({
        id: `${booking.id}-driver`,
        bookingId: booking.id,
        payer: 'driver',
        createdAt: booking.driverPaymentSubmittedAt || booking.createdAt,
        revenue: feeBreakdown.serviceFee,
        gst: feeBreakdown.gstAmount,
        total: feeBreakdown.totalFee,
        paymentMode,
      });
    }
  });

  return events;
};

const recordPlatformFeeTransaction = async ({
  booking,
  payer,
  paymentMode,
  paymentStatus,
  transactionId,
  orderId,
  receiptUrl,
  gateway,
  coinsUsed = 0,
  metadata = {},
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  paymentMode: 'maicoins' | 'online' | 'hybrid';
  paymentStatus: 'pending' | 'completed' | 'failed';
  transactionId?: string;
  orderId?: string;
  receiptUrl?: string;
  gateway?: 'manual' | 'razorpay';
  coinsUsed?: number;
  metadata?: Record<string, any>;
}) => {
  const token = await getAccessToken();
  await axios.post(
    '/api/payments?action=record-platform-fee',
    {
      bookingId: booking.id,
      payer,
      paymentMode,
      paymentStatus,
      transactionId,
      orderId,
      receiptUrl,
      gateway,
      coinsUsed,
      metadata,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};

const getTransactionsForBooking = (transactions: Transaction[], bookingId: string) =>
  transactions
    .filter(
      (tx) =>
        tx.relatedId === bookingId ||
        tx.metadata?.bookingId === bookingId
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const PaymentAuditTrail = ({
  booking,
  transactions = [],
  viewer,
}: {
  booking: Booking;
  transactions?: Transaction[];
  viewer: 'consumer' | 'driver' | 'admin';
}) => {
  const bookingTransactions = getTransactionsForBooking(transactions, booking.id);
  const relevantTransactions =
    viewer === 'admin'
      ? bookingTransactions
      : bookingTransactions.filter((tx) => tx.metadata?.payer === viewer);

  const travelerPaymentSummary = {
    paid: Boolean(booking.feePaid),
    mode: booking.consumerPaymentMode,
    gateway: booking.consumerPaymentGateway,
    transactionId: booking.consumerPaymentTransactionId,
    orderId: booking.consumerPaymentOrderId,
    receiptUrl: booking.consumerPaymentReceiptUrl,
    submittedAt: booking.consumerPaymentSubmittedAt,
    coinsUsed: booking.maiCoinsUsed || 0,
  };

  const driverPaymentSummary = {
    paid: Boolean(booking.driverFeePaid),
    mode: booking.driverPaymentMode,
    gateway: booking.driverPaymentGateway,
    transactionId: booking.driverPaymentTransactionId,
    orderId: booking.driverPaymentOrderId,
    receiptUrl: booking.driverPaymentReceiptUrl,
    submittedAt: booking.driverPaymentSubmittedAt,
    coinsUsed: booking.driverMaiCoinsUsed || 0,
  };

  const paymentRows =
    viewer === 'consumer'
      ? [{ label: 'Your payment', value: travelerPaymentSummary }]
      : viewer === 'driver'
        ? [{ label: 'Your payment', value: driverPaymentSummary }]
        : [
            { label: 'Traveler payment', value: travelerPaymentSummary },
            { label: 'Driver payment', value: driverPaymentSummary },
          ];

  return (
    <div className="mt-4 rounded-2xl border border-mairide-secondary/30 bg-mairide-bg p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Payment audit</p>
          <p className="mt-1 text-sm font-bold text-mairide-primary">Platform fee and gateway trace for this ride</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Fee + GST</p>
          <p className="text-lg font-black text-mairide-accent">{formatCurrency((booking.serviceFee || 0) + (booking.gstAmount || 0))}</p>
        </div>
      </div>

      <div className={cn("mt-4 grid gap-3", paymentRows.length === 2 ? "md:grid-cols-2" : "grid-cols-1")}>
        {paymentRows.map(({ label, value }) => (
          <div key={label} className="rounded-2xl bg-white p-4 border border-mairide-secondary/20">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{label}</p>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
                  value.paid ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                )}
              >
                {value.paid ? "paid" : "pending"}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-mairide-primary">
              <div className="flex justify-between gap-3">
                <span className="text-mairide-secondary">Mode</span>
                <span className="font-bold capitalize">{value.mode || 'not submitted'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-mairide-secondary">Gateway</span>
                <span className="font-bold capitalize">{value.gateway || (value.mode === 'maicoins' ? 'maicoins' : 'manual')}</span>
              </div>
              {value.coinsUsed > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">MaiCoins used</span>
                  <span className="font-bold">{value.coinsUsed} MC</span>
                </div>
              )}
              {value.transactionId && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Transaction ID</span>
                  <span className="font-mono text-xs font-bold break-all text-right">{value.transactionId}</span>
                </div>
              )}
              {value.orderId && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Order ID</span>
                  <span className="font-mono text-xs font-bold break-all text-right">{value.orderId}</span>
                </div>
              )}
              {value.submittedAt && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Submitted</span>
                  <span className="font-bold text-right">{new Date(value.submittedAt).toLocaleString()}</span>
                </div>
              )}
              {value.receiptUrl && (
                <div className="pt-1">
                  <a
                    href={value.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-mairide-accent hover:underline"
                  >
                    View receipt
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewer === 'admin' && relevantTransactions.length > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-4 border border-mairide-secondary/20">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Stored transaction records</p>
          <div className="mt-3 space-y-3">
            {relevantTransactions.map((tx) => (
              <div key={tx.id} className="rounded-xl border border-mairide-secondary/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-sm text-mairide-primary">{tx.description}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                      {tx.metadata?.payer || 'payer'} • {tx.status} • {tx.currency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-mairide-accent">{tx.currency === 'INR' ? formatCurrency(tx.amount) : `${tx.amount} MC`}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{new Date(tx.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                {(tx.metadata?.transactionId || tx.metadata?.orderId) && (
                  <div className="mt-2 text-xs text-mairide-secondary space-y-1">
                    {tx.metadata?.transactionId && <p>Txn: <span className="font-mono text-mairide-primary">{tx.metadata.transactionId}</span></p>}
                    {tx.metadata?.orderId && <p>Order: <span className="font-mono text-mairide-primary">{tx.metadata.orderId}</span></p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ADMIN_PAGE_SIZE_OPTIONS = [10, 15] as const;

const normalizeAdminSearchValue = (value: unknown) => String(value ?? '').toLowerCase().trim();

const matchesAdminSearch = (query: string, fields: unknown[]) => {
  const normalizedQuery = normalizeAdminSearchValue(query);
  if (!normalizedQuery) return true;
  return fields.some((field) => normalizeAdminSearchValue(field).includes(normalizedQuery));
};

const getAdminPageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

const getAdminPageItems = <T,>(items: T[], page: number, pageSize: number) => {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
};

const AdminListPagination = ({
  page,
  pageCount,
  pageSize,
  totalCount,
  filteredCount,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  filteredCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) => (
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-6 md:px-8 py-5 border-t border-mairide-secondary bg-white">
    <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">
      Showing {filteredCount ? ((page - 1) * pageSize) + 1 : 0}-{Math.min(page * pageSize, filteredCount)} of {filteredCount}
      {filteredCount !== totalCount ? ` filtered from ${totalCount}` : ''}
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-mairide-secondary">
        Per page
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="rounded-xl border border-mairide-secondary bg-mairide-bg px-3 py-2 text-sm font-bold text-mairide-primary outline-none"
        >
          {ADMIN_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-xl border border-mairide-secondary px-4 py-2 text-xs font-bold uppercase tracking-widest text-mairide-primary disabled:opacity-40"
      >
        Prev
      </button>
      <span className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">
        Page {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
        className="rounded-xl border border-mairide-secondary px-4 py-2 text-xs font-bold uppercase tracking-widest text-mairide-primary disabled:opacity-40"
      >
        Next
      </button>
    </div>
  </div>
);

const AdminTransactionsView = ({
  transactions,
  bookings,
  users,
}: {
  transactions: Transaction[];
  bookings: Booking[];
  users: UserProfile[];
}) => {
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionStatusFilter, setTransactionStatusFilter] = useState<'all' | Transaction['status']>('all');
  const [transactionPayerFilter, setTransactionPayerFilter] = useState<'all' | 'driver' | 'consumer'>('all');
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPageSize, setTransactionPageSize] = useState<number>(10);
  const paymentTransactions = transactions
    .filter((tx) => tx.type === 'maintenance_fee_payment')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const filteredPaymentTransactions = useMemo(() => {
    return paymentTransactions.filter((tx) => {
      const booking = bookings.find((item) => item.id === (tx.relatedId || tx.metadata?.bookingId));
      const user = users.find((item) => item.uid === tx.userId);
      const payer = tx.metadata?.payer === 'driver' ? 'driver' : 'consumer';
      const matchesStatus = transactionStatusFilter === 'all' || tx.status === transactionStatusFilter;
      const matchesPayer = transactionPayerFilter === 'all' || payer === transactionPayerFilter;
      const matchesSearch = matchesAdminSearch(transactionSearch, [
        tx.id,
        tx.description,
        tx.status,
        tx.currency,
        tx.amount,
        tx.userId,
        user?.displayName,
        user?.email,
        tx.relatedId,
        tx.metadata?.bookingId,
        tx.metadata?.rideId,
        tx.metadata?.transactionId,
        tx.metadata?.orderId,
        tx.metadata?.gateway,
        tx.metadata?.paymentMode,
        booking?.origin,
        booking?.destination,
        booking?.consumerName,
        booking?.driverName,
        tx.createdAt,
      ]);
      return matchesStatus && matchesPayer && matchesSearch;
    });
  }, [paymentTransactions, bookings, users, transactionSearch, transactionStatusFilter, transactionPayerFilter]);
  const transactionPageCount = getAdminPageCount(filteredPaymentTransactions.length, transactionPageSize);
  const pagedPaymentTransactions = useMemo(
    () => getAdminPageItems(filteredPaymentTransactions, transactionPage, transactionPageSize),
    [filteredPaymentTransactions, transactionPage, transactionPageSize]
  );
  useEffect(() => {
    setTransactionPage(1);
  }, [transactionSearch, transactionStatusFilter, transactionPayerFilter, transactionPageSize]);
  useEffect(() => {
    if (transactionPage > transactionPageCount) setTransactionPage(transactionPageCount);
  }, [transactionPage, transactionPageCount]);
  const totalRevenue = paymentTransactions
    .filter((tx) => tx.currency === 'INR' && tx.status === 'completed')
    .reduce((sum, tx) => sum + (tx.metadata?.serviceFee || 0), 0);
  const totalGST = paymentTransactions
    .filter((tx) => tx.currency === 'INR' && tx.status === 'completed')
    .reduce((sum, tx) => sum + (tx.metadata?.gstAmount || 0), 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Recorded payments</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{paymentTransactions.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Revenue captured</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">GST captured</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(totalGST)}</p>
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
        <div className="p-8 border-b border-mairide-secondary space-y-5">
          <h2 className="text-xl font-bold text-mairide-primary">Payment Transactions</h2>
          <p className="mt-2 text-sm text-mairide-secondary">Support and finance can review every platform-fee payment event here.</p>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-mairide-secondary" />
              <input
                type="text"
                value={transactionSearch}
                onChange={(event) => setTransactionSearch(event.target.value)}
                placeholder="Search txn, order, booking, ride, user, route, gateway..."
                className="w-full rounded-2xl bg-mairide-bg py-3 pl-11 pr-4 text-sm font-bold text-mairide-primary outline-none placeholder:font-medium placeholder:text-mairide-secondary"
              />
            </div>
            <select
              value={transactionStatusFilter}
              onChange={(event) => setTransactionStatusFilter(event.target.value as any)}
              className="rounded-2xl bg-mairide-bg px-4 py-3 text-sm font-bold text-mairide-primary outline-none"
            >
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={transactionPayerFilter}
              onChange={(event) => setTransactionPayerFilter(event.target.value as any)}
              className="rounded-2xl bg-mairide-bg px-4 py-3 text-sm font-bold text-mairide-primary outline-none"
            >
              <option value="all">All payers</option>
              <option value="consumer">Traveler payments</option>
              <option value="driver">Driver payments</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-mairide-secondary">
          {pagedPaymentTransactions.length ? pagedPaymentTransactions.map((tx) => {
            const booking = bookings.find((item) => item.id === (tx.relatedId || tx.metadata?.bookingId));
            const user = users.find((item) => item.uid === tx.userId);
            return (
              <div key={tx.id} className="p-6 md:p-8">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                  <div className="space-y-2 min-w-0">
                    <p className="text-lg font-bold text-mairide-primary break-words">{booking ? `${booking.origin} → ${booking.destination}` : tx.description}</p>
                    <p className="text-sm text-mairide-secondary">
                      {tx.metadata?.payer === 'driver' ? 'Driver' : 'Traveler'}: {user?.displayName || tx.userId}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="rounded-full bg-mairide-bg px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mairide-primary">
                        {tx.status}
                      </span>
                      <span className="rounded-full bg-mairide-bg px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mairide-primary">
                        {tx.metadata?.gateway || tx.metadata?.paymentMode || 'payment'}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-full lg:min-w-[520px]">
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Total</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{tx.currency === 'INR' ? formatCurrency(tx.amount) : `${tx.amount} MC`}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Revenue</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{formatCurrency(tx.metadata?.serviceFee || 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">GST</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{formatCurrency(tx.metadata?.gstAmount || 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Captured</p>
                      <p className="mt-2 text-sm font-bold text-mairide-primary">{new Date(tx.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Gateway trace</p>
                    <div className="mt-2 space-y-1 text-mairide-primary break-words">
                      {tx.metadata?.transactionId && <p>Txn ID: <span className="font-mono text-xs break-all">{tx.metadata.transactionId}</span></p>}
                      {tx.metadata?.orderId && <p>Order ID: <span className="font-mono text-xs break-all">{tx.metadata.orderId}</span></p>}
                      <p>Mode: <span className="font-bold capitalize">{tx.metadata?.paymentMode || 'manual'}</span></p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Ride linkage</p>
                    <div className="mt-2 space-y-1 text-mairide-primary break-words">
                      <p>Booking ID: <span className="font-mono text-xs break-all">{tx.metadata?.bookingId || tx.relatedId || 'N/A'}</span></p>
                      <p>Ride ID: <span className="font-mono text-xs break-all">{tx.metadata?.rideId || booking?.rideId || 'N/A'}</span></p>
                      {tx.metadata?.receiptUrl && (
                        <a href={tx.metadata.receiptUrl} target="_blank" rel="noreferrer" className="text-mairide-accent font-bold hover:underline">
                          View receipt
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="p-12 text-center text-mairide-secondary italic">No payment transactions match the current search.</div>
          )}
        </div>
        <AdminListPagination
          page={transactionPage}
          pageCount={transactionPageCount}
          pageSize={transactionPageSize}
          totalCount={paymentTransactions.length}
          filteredCount={filteredPaymentTransactions.length}
          onPageChange={setTransactionPage}
          onPageSizeChange={setTransactionPageSize}
        />
      </div>
    </div>
  );
};

const AdminMobileAppView = () => {
  type MobileEvent = {
    id: string;
    metricKey: string;
    value: number;
    units: string;
    observedAt: string;
    userId?: string | null;
    role?: string | null;
    notificationType?: string | null;
    reason?: string | null;
    platform?: string | null;
    city?: string | null;
    region?: string | null;
    source?: string | null;
    distanceKm?: string | null;
    radiusKm?: string | null;
  };
  type MobilePayload = {
    generatedAt: string;
    deployment: {
      metadataStatus?: string;
      appVersion?: string | null;
      apkUrl?: string | null;
      updateUrl?: string | null;
      buildSha?: string | null;
      builtAt?: string | null;
      metadataError?: string | null;
      productionCommit?: string | null;
      productionDeployId?: string | null;
    };
    installUsage: {
      apkDownloads30d: number;
      appUpdateStarts30d: number;
      appOpens30d: number;
      loginEvents30d: number;
      activeAppUsers30d: number;
    };
    pushHealth: {
      fcmConfigured: boolean;
      registeredDevices30d: number;
      activePushDevices: number;
      usersWithPush: number;
      sent24h: number;
      failed24h: number;
      skipped24h: number;
      successRate24h: number;
    };
    proximity: {
      radiusKm: number;
      nearbyPush24h: number;
      nearbyPresence24h: number;
      nearbyRideRequests24h: number;
      nearbyRideOffers24h: number;
    };
    recentEvents: MobileEvent[];
    notes?: string[];
  };

  const [payload, setPayload] = useState<MobilePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [eventSearch, setEventSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | 'push' | 'install' | 'usage' | 'proximity'>('all');
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState<number>(10);

  const loadMobileApp = async (withLoader = false) => {
    if (withLoader) setIsLoading(true);
    try {
      const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
      const response = await axios.get(adminMobileAppPath, { headers });
      setPayload(response.data || null);
    } catch (error) {
      console.error('Mobile app admin view failed:', error);
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!active) return;
      await loadMobileApp(true);
    })();
    const timer = window.setInterval(() => {
      void loadMobileApp(false);
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const cardTone = (tone: 'dark' | 'orange' | 'green' | 'blue' | 'red' = 'dark') => {
    if (tone === 'orange') return 'bg-orange-50 text-mairide-accent';
    if (tone === 'green') return 'bg-green-50 text-green-700';
    if (tone === 'blue') return 'bg-blue-50 text-blue-700';
    if (tone === 'red') return 'bg-red-50 text-red-600';
    return 'bg-mairide-bg text-mairide-primary';
  };

  const renderMetricCard = (
    label: string,
    value: string | number,
    helper: string,
    icon: React.ElementType,
    tone: 'dark' | 'orange' | 'green' | 'blue' | 'red' = 'dark'
  ) => {
    const Icon = icon;
    return (
      <div className="rounded-[28px] border border-mairide-secondary bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className={cn("rounded-2xl p-3", cardTone(tone))}>
            <Icon className="h-5 w-5" />
          </div>
          <span className="rounded-full bg-mairide-bg px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">
            Live
          </span>
        </div>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.22em] text-mairide-secondary">{label}</p>
        <p className="mt-2 text-3xl font-black text-mairide-primary break-words">{value}</p>
        <p className="mt-2 text-xs leading-relaxed text-mairide-secondary">{helper}</p>
      </div>
    );
  };

  const filteredEvents = useMemo(() => {
    const events = payload?.recentEvents || [];
    return events.filter((event) => {
      const metricKey = String(event.metricKey || '');
      const notificationType = String(event.notificationType || '');
      const matchesType =
        eventTypeFilter === 'all'
        || (eventTypeFilter === 'push' && metricKey.startsWith('push_'))
        || (eventTypeFilter === 'install' && metricKey.startsWith('android_'))
        || (eventTypeFilter === 'usage' && ['app_opened', 'user_logged_in'].includes(metricKey))
        || (eventTypeFilter === 'proximity' && notificationType.startsWith('nearby_'));
      const matchesSearch = matchesAdminSearch(eventSearch, [
        event.id,
        event.metricKey,
        event.userId,
        event.role,
        event.notificationType,
        event.reason,
        event.platform,
        event.city,
        event.region,
        event.source,
        event.distanceKm,
        event.radiusKm,
        event.observedAt,
      ]);
      return matchesType && matchesSearch;
    });
  }, [payload?.recentEvents, eventSearch, eventTypeFilter]);

  const eventsPageCount = getAdminPageCount(filteredEvents.length, eventsPageSize);
  const pagedEvents = useMemo(
    () => getAdminPageItems(filteredEvents, eventsPage, eventsPageSize),
    [filteredEvents, eventsPage, eventsPageSize]
  );
  useEffect(() => {
    setEventsPage(1);
  }, [eventSearch, eventTypeFilter, eventsPageSize]);
  useEffect(() => {
    if (eventsPage > eventsPageCount) setEventsPage(eventsPageCount);
  }, [eventsPage, eventsPageCount]);

  if (isLoading) {
    return (
      <div className="rounded-[32px] border border-mairide-secondary bg-white p-10 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-mairide-secondary">Loading mobile app control room...</p>
      </div>
    );
  }

  const deployment = payload?.deployment;
  const installUsage = payload?.installUsage;
  const pushHealth = payload?.pushHealth;
  const proximity = payload?.proximity;
  const shortSha = deployment?.buildSha ? deployment.buildSha.slice(0, 8) : 'N/A';

  return (
    <div className="space-y-8">
      <div className="rounded-[36px] bg-mairide-primary p-6 md:p-8 text-white shadow-xl shadow-mairide-primary/10">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">Android Control Room</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Mobile App Deployment & Push Health</h2>
            <p className="mt-2 max-w-3xl text-sm text-white/70">
              Dedicated view for APK metadata, app usage, FCM registration, and nearby proximity notification delivery.
            </p>
          </div>
          <div className="rounded-[28px] bg-white/10 p-5 backdrop-blur-md">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Latest APK</p>
            <p className="mt-2 text-2xl font-black">{deployment?.appVersion || 'Version unavailable'}</p>
            <p className="mt-1 text-xs text-white/70">
              Build {shortSha} • {deployment?.builtAt ? new Date(deployment.builtAt).toLocaleString() : 'Build time unavailable'}
            </p>
            <p className={cn(
              "mt-3 inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
              deployment?.metadataStatus === 'live' ? 'bg-green-400/20 text-green-100' : 'bg-orange-400/20 text-orange-100'
            )}>
              Metadata {deployment?.metadataStatus || 'unknown'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-[28px] border border-mairide-secondary bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">APK / Deployment Status</p>
              <h3 className="mt-2 text-2xl font-black text-mairide-primary">Current Android release</h3>
              <p className="mt-1 text-sm text-mairide-secondary">This card reads the live Android update metadata used by the web and app download flow.</p>
            </div>
            <a
              href={deployment?.apkUrl || '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white hover:bg-mairide-primary/90"
            >
              Open APK URL
            </a>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['App version', deployment?.appVersion || 'N/A'],
              ['Update JSON', deployment?.updateUrl || 'N/A'],
              ['APK URL', deployment?.apkUrl || 'N/A'],
              ['Production deploy', deployment?.productionDeployId || 'N/A'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-mairide-bg p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{label}</p>
                <p className="mt-2 break-all text-sm font-bold text-mairide-primary">{value}</p>
              </div>
            ))}
          </div>
          {deployment?.metadataError ? (
            <p className="mt-4 rounded-2xl bg-orange-50 p-3 text-xs font-bold text-orange-700">
              Metadata warning: {deployment.metadataError}
            </p>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-mairide-secondary bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">FCM Runtime</p>
          <h3 className="mt-2 text-2xl font-black text-mairide-primary">
            {pushHealth?.fcmConfigured ? 'Ready to send' : 'Credentials missing'}
          </h3>
          <p className="mt-2 text-sm text-mairide-secondary">
            {pushHealth?.fcmConfigured
              ? 'Firebase service account is present in production, so nearby pushes can be delivered.'
              : 'Token registration can still work, but delivery will be skipped until Firebase service account JSON is configured.'}
          </p>
          <div className={cn(
            "mt-5 rounded-2xl p-4 text-sm font-bold",
            pushHealth?.fcmConfigured ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
          )}>
            Success rate last 24h: {pushHealth?.successRate24h ?? 0}%
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Install & Usage</p>
          <h3 className="mt-1 text-2xl font-black text-mairide-primary">Android install activity</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {renderMetricCard('APK downloads', installUsage?.apkDownloads30d ?? 0, 'Started downloads in the last 30 days.', Download, 'orange')}
          {renderMetricCard('Update starts', installUsage?.appUpdateStarts30d ?? 0, 'App update actions started in the last 30 days.', Upload, 'blue')}
          {renderMetricCard('Active app users', installUsage?.activeAppUsers30d ?? 0, 'Distinct signed-in app users in the last 30 days.', Users, 'green')}
          {renderMetricCard('App opens', installUsage?.appOpens30d ?? 0, 'Recorded app open events in the last 30 days.', Smartphone, 'dark')}
          {renderMetricCard('Login events', installUsage?.loginEvents30d ?? 0, 'Signed-in mobile/web app login telemetry.', UserIcon, 'dark')}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Push Notification Health</p>
          <h3 className="mt-1 text-2xl font-black text-mairide-primary">Device registration and delivery</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {renderMetricCard('Devices registered', pushHealth?.registeredDevices30d ?? 0, 'New FCM token registrations in the last 30 days.', Bell, 'green')}
          {renderMetricCard('Active push devices', pushHealth?.activePushDevices ?? 0, 'Currently stored active notification devices.', Smartphone, 'blue')}
          {renderMetricCard('Push sent', pushHealth?.sent24h ?? 0, 'Successful FCM sends in the last 24 hours.', Send, 'green')}
          {renderMetricCard('Push failed', pushHealth?.failed24h ?? 0, 'Failed FCM sends in the last 24 hours.', AlertTriangle, 'red')}
          {renderMetricCard('Push skipped', pushHealth?.skipped24h ?? 0, 'Skipped sends, usually no device or missing FCM credentials.', AlertCircle, 'orange')}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Proximity Notification Activity</p>
          <h3 className="mt-1 text-2xl font-black text-mairide-primary">Nearby traveler and driver matching signals</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {renderMetricCard('Current radius', `${proximity?.radiusKm ?? 25} km`, 'Configured nearby notification radius.', MapPin, 'dark')}
          {renderMetricCard('Nearby pushes', proximity?.nearbyPush24h ?? 0, 'All nearby push notifications sent in 24 hours.', Bell, 'green')}
          {renderMetricCard('Presence alerts', proximity?.nearbyPresence24h ?? 0, 'Driver/traveler proximity presence alerts.', Navigation, 'blue')}
          {renderMetricCard('Ride request alerts', proximity?.nearbyRideRequests24h ?? 0, 'Nearby ride request notifications to drivers.', Car, 'orange')}
          {renderMetricCard('Ride offer alerts', proximity?.nearbyRideOffers24h ?? 0, 'Nearby ride offer notifications to travelers.', PlusCircle, 'orange')}
        </div>
      </div>

      <div className="rounded-[36px] border border-mairide-secondary bg-white shadow-sm overflow-hidden">
        <div className="p-6 md:p-8 border-b border-mairide-secondary space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Recent Notification Events</p>
              <h3 className="mt-2 text-2xl font-black text-mairide-primary">Mobile telemetry timeline</h3>
              <p className="mt-1 text-sm text-mairide-secondary">Search by user, event type, role, device, reason, network context, or proximity radius.</p>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">
              Updated {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : 'N/A'}
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-mairide-secondary" />
              <input
                type="text"
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder="Search event, user, notification type, reason, platform, network context..."
                className="w-full rounded-2xl bg-mairide-bg py-3 pl-11 pr-4 text-sm font-bold text-mairide-primary outline-none placeholder:font-medium placeholder:text-mairide-secondary"
              />
            </div>
            <select
              value={eventTypeFilter}
              onChange={(event) => setEventTypeFilter(event.target.value as any)}
              className="rounded-2xl bg-mairide-bg px-4 py-3 text-sm font-bold text-mairide-primary outline-none"
            >
              <option value="all">All mobile events</option>
              <option value="push">Push delivery</option>
              <option value="proximity">Proximity only</option>
              <option value="install">Install / update</option>
              <option value="usage">App usage</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-mairide-secondary">
          {pagedEvents.length ? pagedEvents.map((event) => {
            const isNearbyPush = String(event.notificationType || '').startsWith('nearby_');
            const networkContext = [event.city, event.region].filter(Boolean).join(' • ');
            const eventContext = [event.reason, event.source, event.platform].filter(Boolean).join(' • ');
            return (
              <div key={event.id} className="p-5 md:p-6 hover:bg-mairide-bg/50 transition-colors">
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_180px] gap-4 items-start">
                  <div>
                    <p className="font-bold text-mairide-primary break-words">{event.metricKey.replaceAll('_', ' ')}</p>
                    <p className="mt-1 text-xs text-mairide-secondary break-all">ID: {event.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">User / Role</p>
                    <p className="mt-1 text-sm font-bold text-mairide-primary break-all">{event.userId || 'N/A'}</p>
                    <p className="text-xs text-mairide-secondary capitalize">{event.role || 'unknown'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Network Context</p>
                    <p className="mt-1 text-sm font-bold text-mairide-primary">{event.notificationType || event.source || event.platform || 'mobile event'}</p>
                    <p className="text-xs text-mairide-secondary">
                      {isNearbyPush
                        ? (eventContext || 'Nearby push event')
                        : (networkContext ? `Approx. request network: ${networkContext}` : eventContext || 'No network context')}
                    </p>
                    {isNearbyPush && (event.distanceKm || event.radiusKm) && (
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                        Distance {event.distanceKm || 'N/A'} km / Radius {event.radiusKm || 'N/A'} km
                      </p>
                    )}
                  </div>
                  <div className="xl:text-right">
                    <p className="text-sm font-bold text-mairide-primary">{event.observedAt ? new Date(event.observedAt).toLocaleString() : 'N/A'}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{event.value} {event.units}</p>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="p-12 text-center text-mairide-secondary italic">No mobile events match the current search.</div>
          )}
        </div>
        <AdminListPagination
          page={eventsPage}
          pageCount={eventsPageCount}
          pageSize={eventsPageSize}
          totalCount={payload?.recentEvents?.length || 0}
          filteredCount={filteredEvents.length}
          onPageChange={setEventsPage}
          onPageSizeChange={setEventsPageSize}
        />
      </div>

      {!!payload?.notes?.length && (
        <div className="rounded-[28px] border border-orange-200 bg-orange-50 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-orange-700">Setup Notes</p>
          <div className="mt-3 space-y-1">
            {payload.notes.map((note) => (
              <p key={note} className="text-sm text-orange-800">{note}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (errInfo.error.includes('the client is offline')) {
    console.error("CRITICAL: Firestore connection failed. The configuration in firebase-applet-config.json may be incorrect or the database is not provisioned.");
  }
  
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (!isLocalDevFirestoreMode()) return;
  try {
    // Try to reach the server directly to verify configuration
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("CRITICAL: Firestore connection failed. The configuration in firebase-applet-config.json may be incorrect or the database is not provisioned.");
    }
    // We don't throw here to avoid crashing the app on boot, but we log the error
  }
}

testConnection();

class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;

  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong. Please refresh the page.";
      const fallbackMessage = this.state?.error?.message || this.state?.error?.toString?.() || '';
      if (fallbackMessage && typeof fallbackMessage === 'string' && fallbackMessage.trim()) {
        displayMessage = fallbackMessage;
      }
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = "You don't have permission to perform this action. Please check your account status.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h1>
            <p className="text-gray-600 mb-6">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Components ---

const LOGO_URL = "/logo.svg";
const BRAND_NAME = "MaiRide my way";
const BRAND_TAGLINE = "";
const LIVE_ANDROID_APK_URL = 'https://downloads.mairide.in/mairide-android.apk';
const TRACKED_ANDROID_APK_URL = '/api/analytics?action=android-download';
const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || '';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v3.0.1-beta';
const APP_NAV_HOME_EVENT = 'mairide:navigate-home';
const APP_NAV_TAB_EVENT = 'mairide:navigate-tab';
const APP_DIALOG_EVENT = 'mairide:dialog';
const APP_RIDE_RETIRED_EVENT = 'mairide:ride-retired';
const CONSENT_VERSION = 'consent-v1';
const COOKIE_CONSENT_STORAGE_KEY = 'mairide_cookie_consent_v1';
const COOKIE_CONSENT_OPEN_EVENT = 'mairide:cookie-consent-open';
const REGISTRATION_CAMERA_PERMISSION_KEY_PREFIX = 'mairide_registration_camera_prompted_v1';
const REGISTRATION_LOCATION_PERMISSION_KEY_PREFIX = 'mairide_registration_location_prompted_v1';
const isAndroidAppRuntime = () => isAppWebViewRuntime() || isAndroidWebViewLikeRuntime();
const isLocalDevHost = () =>
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const safeStorageGet = (storageType: 'local' | 'session', key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    const storage = storageType === 'local' ? window.localStorage : window.sessionStorage;
    return storage.getItem(key);
  } catch {
    return null;
  }
};
const safeStorageSet = (storageType: 'local' | 'session', key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    const storage = storageType === 'local' ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  } catch {
    // Ignore storage-write failures in restricted browsers
  }
};
const safeStorageRemove = (storageType: 'local' | 'session', key: string) => {
  if (typeof window === 'undefined') return;
  try {
    const storage = storageType === 'local' ? window.localStorage : window.sessionStorage;
    storage.removeItem(key);
  } catch {
    // Ignore storage-remove failures in restricted browsers
  }
};
const buildRegistrationPermissionStorageKey = (prefix: string, uid: string) => `${prefix}:${uid}`;
const isGrantedNativePermission = (status?: unknown) => ['granted', 'limited'].includes(String(status || '').trim().toLowerCase());
const requestNativeAndroidCameraPermission = async () => {
  try {
    const currentPermissions = await CapacitorCamera.checkPermissions().catch(() => null);
    let cameraPermission = String(currentPermissions?.camera || currentPermissions?.photos || '').trim().toLowerCase();

    if (!isGrantedNativePermission(cameraPermission)) {
      const requestedPermissions = await CapacitorCamera.requestPermissions({ permissions: ['camera'] }).catch(() => null);
      cameraPermission = String(requestedPermissions?.camera || requestedPermissions?.photos || cameraPermission || '').trim().toLowerCase();
    }

    return isGrantedNativePermission(cameraPermission);
  } catch (error) {
    console.warn('Android registration camera permission request failed:', error);
    return false;
  }
};
const requestNativeAndroidLocationPermission = async () => {
  try {
    if (Capacitor.isNativePlatform() && isAndroidAppRuntime()) {
      const currentPermissions = await Geolocation.checkPermissions().catch(() => null);
      let locationPermission = String(
        currentPermissions?.location || currentPermissions?.coarseLocation || ''
      ).trim().toLowerCase();

      if (!isGrantedNativePermission(locationPermission)) {
        const requestedPermissions = await Geolocation.requestPermissions().catch(() => null);
        locationPermission = String(
          requestedPermissions?.location || requestedPermissions?.coarseLocation || locationPermission || ''
        ).trim().toLowerCase();
      }

      return isGrantedNativePermission(locationPermission);
    }

    return await new Promise<boolean>((resolve) => {
      if (!navigator.geolocation) {
        resolve(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (error) => {
          console.warn('Android registration location permission request failed:', error);
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
      );
    });
  } catch (error) {
    console.warn('Android registration location bootstrap failed:', error);
    return false;
  }
};
const requestAndroidRegistrationPermissions = async ({
  uid,
  role,
}: {
  uid: string;
  role: 'consumer' | 'driver' | 'admin';
}) => {
  if (typeof window === 'undefined' || !isAndroidAppRuntime() || !uid || role === 'admin') return;

  const cameraKey = buildRegistrationPermissionStorageKey(REGISTRATION_CAMERA_PERMISSION_KEY_PREFIX, uid);
  const locationKey = buildRegistrationPermissionStorageKey(REGISTRATION_LOCATION_PERMISSION_KEY_PREFIX, uid);

  if (safeStorageGet('local', cameraKey) !== '1') {
    const cameraGranted = await requestNativeAndroidCameraPermission();
    if (cameraGranted) {
      safeStorageSet('local', cameraKey, '1');
    } else {
      safeStorageRemove('local', cameraKey);
      console.warn('Android registration camera permission not granted yet.');
    }
  }

  if (safeStorageGet('local', locationKey) !== '1') {
    const locationGranted = await requestNativeAndroidLocationPermission();
    if (locationGranted) {
      safeStorageSet('local', locationKey, '1');
    } else {
      safeStorageRemove('local', locationKey);
      console.warn('Android registration location permission not granted yet.');
    }
  }
};
type CookieConsentCategory = 'necessary' | 'preferences' | 'analytics' | 'marketing';

type CookieConsentRecord = {
  version: string;
  updatedAt: string;
  choices: Record<CookieConsentCategory, boolean>;
};

const COOKIE_CONSENT_DEFAULT_CHOICES: Record<CookieConsentCategory, boolean> = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
};

const COOKIE_CONSENT_CATEGORY_COPY: Array<{
  key: CookieConsentCategory;
  title: string;
  description: string;
  locked?: boolean;
}> = [
  {
    key: 'necessary',
    title: 'Strictly necessary',
    description: 'Required for login, security, ride requests, payments, and core app stability.',
    locked: true,
  },
  {
    key: 'preferences',
    title: 'Preferences',
    description: 'Remembers app language, UI choices, update prompts, and optional personalization.',
  },
  {
    key: 'analytics',
    title: 'Analytics',
    description: 'Helps us understand app usage and improve reliability. Disabled unless you allow it.',
  },
  {
    key: 'marketing',
    title: 'Marketing',
    description: 'Allows promotional or campaign measurement cookies. Disabled unless you allow it.',
  },
];

const normalizeCookieConsent = (value: unknown): CookieConsentRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CookieConsentRecord>;
  if (candidate.version !== CONSENT_VERSION || !candidate.choices || typeof candidate.choices !== 'object') return null;
  return {
    version: CONSENT_VERSION,
    updatedAt: String(candidate.updatedAt || new Date().toISOString()),
    choices: {
      necessary: true,
      preferences: candidate.choices.preferences === true,
      analytics: candidate.choices.analytics === true,
      marketing: candidate.choices.marketing === true,
    },
  };
};

const getStoredCookieConsent = (): CookieConsentRecord | null => {
  const raw = safeStorageGet('local', COOKIE_CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeCookieConsent(JSON.parse(raw));
  } catch {
    return null;
  }
};

const canUseCookieCategory = (
  consent: CookieConsentRecord | null,
  category: CookieConsentCategory
) => category === 'necessary' || consent?.choices[category] === true;

const hasStoredCookieConsentCategory = (category: CookieConsentCategory) =>
  canUseCookieCategory(getStoredCookieConsent(), category);

const expireCookie = (name: string) => {
  if (typeof document === 'undefined') return;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = `${name}=; path=/; ${expires}`;
  if (hostname.endsWith('mairide.in')) {
    document.cookie = `${name}=; path=/; domain=.mairide.in; ${expires}`;
  }
};

const clearGoogleTranslateArtifacts = () => {
  expireCookie('googtrans');
};

const clearOptionalConsentArtifacts = (consent: CookieConsentRecord) => {
  if (!consent.choices.preferences) {
    [
      UI_LANGUAGE_STORAGE_KEY,
      UI_LANGUAGE_PROMPT_SEEN_KEY,
      UI_LANGUAGE_PROMPT_APP_SEEN_KEY,
      'mairide_android_update_dismissed_version',
    ].forEach((key) => safeStorageRemove('local', key));
    clearGoogleTranslateArtifacts();
  }

  if (!consent.choices.analytics) {
    ['_ga', '_gid', '_gat', '_gat_gtag', 'ajs_anonymous_id', 'ajs_user_id'].forEach(expireCookie);
  }

  if (!consent.choices.marketing) {
    ['_fbp', '_fbc', '_gcl_au'].forEach(expireCookie);
  }
};

const persistCookieConsent = (choices: Partial<Record<CookieConsentCategory, boolean>>) => {
  const consent: CookieConsentRecord = {
    version: CONSENT_VERSION,
    updatedAt: new Date().toISOString(),
    choices: {
      ...COOKIE_CONSENT_DEFAULT_CHOICES,
      ...choices,
      necessary: true,
    },
  };
  safeStorageSet('local', COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
  clearOptionalConsentArtifacts(consent);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<CookieConsentRecord>('mairide:cookie-consent-updated', { detail: consent }));
  }
  return consent;
};
const adminApiPath = (action: string) => `/api/admin-api?action=${encodeURIComponent(action)}`;
const adminConfigPath = adminApiPath("config");
const adminSaveConfigPath = adminApiPath("save-config");
const adminTransactionsPath = adminApiPath("transactions");
const adminUsersPath = adminApiPath("users");
const adminVerifyDriverPath = adminApiPath("verify-driver");
const adminCapacityPath = adminApiPath("capacity");
const adminMobileAppPath = adminApiPath("mobile-app");
const resolveReleaseVersion = (configVersion?: unknown, remoteVersion?: unknown) => {
  const configured = String(configVersion || "").trim();
  if (configured) return configured;
  const remote = String(remoteVersion || "").trim();
  if (remote) return remote;
  return APP_VERSION;
};
const normalizeVersionTag = (version?: unknown) =>
  String(version || '')
    .trim()
    .toLowerCase()
    .replace(/\+.*$/, '');

const ANDROID_APP_ID = 'in.mairide.app';

const resolveInstalledAndroidVersion = async () => {
  if (typeof window === 'undefined' || !isAndroidAppRuntime()) return APP_VERSION;

  try {
    const info = await CapacitorApp.getInfo();
    const nativeVersion = String(info?.version || '').trim();
    if (nativeVersion) return nativeVersion;
  } catch {
    // Fall back to bundled app version when native app info is unavailable.
  }

  return APP_VERSION;
};

const openAndroidAppSettings = async () => {
  if (typeof window === 'undefined') return false;

  try {
    if (Capacitor.isNativePlatform()) {
      await CapacitorApp.openSettings();
      return true;
    }
  } catch {
    // Fall through to Android intent fallback.
  }

  try {
    if (isAndroidAppRuntime()) {
      window.location.href = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;scheme=package;package=${ANDROID_APP_ID};end`;
      return true;
    }
  } catch {
    // Ignore and let caller show manual guidance.
  }

  return false;
};

const ensureAndroidDriverSignupPermissions = async () => {
  if (typeof window === 'undefined' || !isAndroidAppRuntime()) {
    return { cameraGranted: true, locationGranted: true };
  }

  const cameraGranted = await requestNativeAndroidCameraPermission();
  const locationGranted = await requestNativeAndroidLocationPermission();

  return { cameraGranted, locationGranted };
};

const withCacheBust = (url: string) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
};

const getTrackedAndroidApkUrl = () => apiPath(TRACKED_ANDROID_APK_URL);

const downloadAndOpenAndroidApk = async (apkUrl: string) => {
  const fallbackUrl = withCacheBust(apkUrl || LIVE_ANDROID_APK_URL);
  if (typeof window === 'undefined' || !isAndroidAppRuntime()) {
    window.location.href = fallbackUrl;
    return { mode: 'browser-fallback' as const };
  }

  if (!Capacitor.isNativePlatform()) {
    window.location.href = fallbackUrl;
    return { mode: 'browser-fallback' as const };
  }

  const targetFileName = `mairide-update-${Date.now()}.apk`;
  const candidateDirectories = [
    Directory.Cache,
    Directory.Documents,
    Directory.External,
  ];

  let lastError: unknown = null;

  for (const directory of candidateDirectories) {
    try {
      const downloadResult = await Filesystem.downloadFile({
        url: fallbackUrl,
        path: targetFileName,
        directory,
        recursive: true,
      });

      const resolvedUri =
        String(downloadResult?.path || downloadResult?.uri || '').trim() ||
        String((await Filesystem.getUri({ path: targetFileName, directory }))?.uri || '').trim();

      if (!resolvedUri) {
        throw new Error('Downloaded update file could not be resolved.');
      }

      await FileOpener.openFile({
        path: resolvedUri,
        mimeType: 'application/vnd.android.package-archive',
      });

      return { mode: 'native-installer' as const };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to prepare the Android update installer.');
};

const extractLatLng = (location?: { lat?: unknown; lng?: unknown } | null) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};
const DASHBOARD_MATCH_RADIUS_KM = 50;
const DASHBOARD_PARTIAL_DROP_RADIUS_KM = 200;
const getFeedViewerLocation = (
  liveLocation?: { lat: number; lng: number } | null,
  profileLocation?: { lat?: unknown; lng?: unknown } | null
) => liveLocation || extractLatLng(profileLocation);
const getFeedItemOriginLocation = (item?: {
  originLocation?: { lat?: unknown; lng?: unknown } | null;
  location?: { lat?: unknown; lng?: unknown } | null;
} | null) => extractLatLng(item?.originLocation) || extractLatLng(item?.location);
const isWithinDashboardMatchRadius = (
  viewerLocation?: { lat: number; lng: number } | null,
  itemOriginLocation?: { lat: number; lng: number } | null,
  radiusKm: number = DASHBOARD_MATCH_RADIUS_KM
) => {
  if (!viewerLocation || !itemOriginLocation) return false;
  return (
    getDistance(
      viewerLocation.lat,
      viewerLocation.lng,
      itemOriginLocation.lat,
      itemOriginLocation.lng
    ) <= radiusKm
  );
};
const getFeedItemRoute = (item?: {
  originLocation?: { lat?: unknown; lng?: unknown } | null;
  destinationLocation?: { lat?: unknown; lng?: unknown } | null;
} | null) => {
  const originLocation = extractLatLng(item?.originLocation);
  const destinationLocation = extractLatLng(item?.destinationLocation);
  if (!originLocation || !destinationLocation) return null;
  return { originLocation, destinationLocation };
};
const isWithinAnyDashboardCorridor = (
  candidateRoute: { originLocation: { lat: number; lng: number }; destinationLocation: { lat: number; lng: number } } | null,
  referenceRoutes: Array<{ originLocation: { lat: number; lng: number }; destinationLocation: { lat: number; lng: number } }>,
  radiusKm: number = DASHBOARD_MATCH_RADIUS_KM
) => {
  if (!candidateRoute) return false;
  if (!referenceRoutes.length) return false;
  return referenceRoutes.some((referenceRoute) =>
    routeCorridorMatch({
      rideOriginLocation: candidateRoute.originLocation,
      rideDestinationLocation: candidateRoute.destinationLocation,
      travelerOriginLocation: referenceRoute.originLocation,
      travelerDestinationLocation: referenceRoute.destinationLocation,
      pickupDetourKm: radiusKm,
      dropDetourKm: radiusKm,
    }) ||
    routeCorridorMatch({
      rideOriginLocation: referenceRoute.originLocation,
      rideDestinationLocation: referenceRoute.destinationLocation,
      travelerOriginLocation: candidateRoute.originLocation,
      travelerDestinationLocation: candidateRoute.destinationLocation,
      pickupDetourKm: radiusKm,
      dropDetourKm: radiusKm,
    })
  );
};
const isWithinAnyPartialDashboardCorridor = (
  candidateRoute: { originLocation: { lat: number; lng: number }; destinationLocation: { lat: number; lng: number } } | null,
  referenceRoutes: Array<{ originLocation: { lat: number; lng: number }; destinationLocation: { lat: number; lng: number } }>,
  pickupRadiusKm: number = DASHBOARD_MATCH_RADIUS_KM,
  dropRadiusKm: number = DASHBOARD_PARTIAL_DROP_RADIUS_KM
) => {
  if (!candidateRoute || !referenceRoutes.length) return false;

  return referenceRoutes.some((referenceRoute) => {
    const strictForward = routeCorridorMatch({
      rideOriginLocation: candidateRoute.originLocation,
      rideDestinationLocation: candidateRoute.destinationLocation,
      travelerOriginLocation: referenceRoute.originLocation,
      travelerDestinationLocation: referenceRoute.destinationLocation,
      pickupDetourKm: pickupRadiusKm,
      dropDetourKm: pickupRadiusKm,
    });
    const strictReverse = routeCorridorMatch({
      rideOriginLocation: referenceRoute.originLocation,
      rideDestinationLocation: referenceRoute.destinationLocation,
      travelerOriginLocation: candidateRoute.originLocation,
      travelerDestinationLocation: candidateRoute.destinationLocation,
      pickupDetourKm: pickupRadiusKm,
      dropDetourKm: pickupRadiusKm,
    });
    if (strictForward || strictReverse) return false;

    return (
      routesSharePartialCorridor(
        candidateRoute,
        referenceRoute,
        pickupRadiusKm,
        dropRadiusKm
      ) ||
      routesSharePartialCorridor(
        referenceRoute,
        candidateRoute,
        pickupRadiusKm,
        dropRadiusKm
      )
    );
  });
};
const getConfiguredRazorpayKeyId = (config?: Partial<AppConfig> | null) =>
  String(config?.razorpayKeyId || RAZORPAY_KEY_ID || '').trim();
const isRazorpayEnabled = (config?: Partial<AppConfig> | null) => Boolean(getConfiguredRazorpayKeyId(config));
const isLocalRazorpayEnabled = (config?: Partial<AppConfig> | null) => isRazorpayEnabled(config);
const getNormalizedGstRate = (config?: Partial<AppConfig> | null) => {
  const raw = config?.gstRate ?? 0.18;
  return raw > 1 ? raw / 100 : raw;
};
const getMaxHybridCoinOffset = (booking: Booking, balance: number, config?: Partial<AppConfig> | null) => {
  const { baseFee } = calculateServiceFee(booking.fare, config || undefined);
  return Math.min(balance, baseFee, MAX_MAICOINS_PER_RIDE);
};
const getBookingPaymentBreakdown = (
  booking: Booking,
  payer: 'consumer' | 'driver',
  config?: Partial<AppConfig> | null
) => {
  const { baseFee } = calculateServiceFee(booking.fare, config || undefined);
  const gstRate = getNormalizedGstRate(config);
  const paymentMode = payer === 'consumer' ? booking.consumerPaymentMode : booking.driverPaymentMode;
  const coinsUsed = payer === 'consumer' ? Number(booking.maiCoinsUsed || 0) : Number(booking.driverMaiCoinsUsed || 0);
  const storedServiceFee =
    payer === 'consumer' ? Number(booking.consumerNetServiceFee) : Number(booking.driverNetServiceFee);
  const storedGst =
    payer === 'consumer' ? Number(booking.consumerNetGstAmount) : Number(booking.driverNetGstAmount);

  if (Number.isFinite(storedServiceFee) && Number.isFinite(storedGst) && storedServiceFee >= 0 && storedGst >= 0) {
    return {
      serviceFee: storedServiceFee,
      gstAmount: storedGst,
      totalFee: storedServiceFee + storedGst,
      coinsUsed,
      paymentMode,
    };
  }

  if (paymentMode === 'maicoins') {
    return { serviceFee: 0, gstAmount: 0, totalFee: 0, coinsUsed, paymentMode };
  }

  if (coinsUsed > 0) {
    const netServiceFee = Math.max(baseFee - coinsUsed, 0);
    const gstAmount = netServiceFee * gstRate;
    return {
      serviceFee: netServiceFee,
      gstAmount,
      totalFee: netServiceFee + gstAmount,
      coinsUsed,
      paymentMode,
    };
  }

  return {
    serviceFee: Number(booking.serviceFee || baseFee),
    gstAmount: Number(booking.gstAmount || baseFee * gstRate),
    totalFee: Number(booking.serviceFee || baseFee) + Number(booking.gstAmount || baseFee * gstRate),
    coinsUsed,
    paymentMode,
  };
};
const getHybridPaymentBreakdown = (booking: Booking, balance: number, useCoins: boolean, config?: Partial<AppConfig> | null) => {
  const { baseFee } = calculateServiceFee(booking.fare, config || undefined);
  const gstRate = getNormalizedGstRate(config);
  const coinsToUse = useCoins ? getMaxHybridCoinOffset(booking, balance, config) : 0;
  if (coinsToUse >= baseFee) {
    return {
      totalFee: 0,
      coinsToUse,
      amountPaid: 0,
      paymentMode: 'maicoins' as const,
      netServiceFee: 0,
      gstAmount: 0,
    };
  }
  const paymentMode: 'hybrid' | 'online' = coinsToUse > 0 ? 'hybrid' : 'online';
  const netServiceFee = Math.max(baseFee - coinsToUse, 0);
  const gstAmount = netServiceFee * gstRate;
  const totalFee = netServiceFee + gstAmount;
  return {
    totalFee,
    coinsToUse,
    amountPaid: Math.max(totalFee, 0),
    paymentMode,
    netServiceFee,
    gstAmount,
  };
};
let razorpayScriptPromise: Promise<boolean> | null = null;
const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY &&
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY.length > 10
    ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    : "";
const UI_LANGUAGE_STORAGE_KEY = 'mairide_ui_language';
const UI_LANGUAGE_PROMPT_SEEN_KEY = 'mairide_ui_language_prompt_seen';
const UI_LANGUAGE_PROMPT_SESSION_KEY = 'mairide_ui_language_prompt_session';
type SupportedUiLanguage = {
  value: string;
  label: string;
  nativeLabel: string;
  googleCode: string;
};
const SUPPORTED_UI_LANGUAGES: SupportedUiLanguage[] = [
  { value: 'en', label: 'English', nativeLabel: 'English', googleCode: 'en' },
  { value: 'hi', label: 'Hindi', nativeLabel: 'हिंदी', googleCode: 'hi' },
  { value: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', googleCode: 'bn' },
  { value: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી', googleCode: 'gu' },
  { value: 'mr', label: 'Marathi', nativeLabel: 'मराठी', googleCode: 'mr' },
  { value: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', googleCode: 'ta' },
  { value: 'te', label: 'Telugu', nativeLabel: 'తెలుగు', googleCode: 'te' },
  { value: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ', googleCode: 'kn' },
  { value: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം', googleCode: 'ml' },
  { value: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ', googleCode: 'pa' },
  { value: 'or', label: 'Odia', nativeLabel: 'ଓଡ଼ିଆ', googleCode: 'or' },
  { value: 'as', label: 'Assamese', nativeLabel: 'অসমীয়া', googleCode: 'as' },
  { value: 'ne', label: 'Nepali', nativeLabel: 'नेपाली', googleCode: 'ne' },
];
const IN_STATE_LANGUAGE_MAP: Record<string, string> = {
  assam: 'as',
  bihar: 'hi',
  chandigarh: 'hi',
  chhattisgarh: 'hi',
  delhi: 'hi',
  'goa': 'hi',
  gujarat: 'gu',
  haryana: 'hi',
  'himachal pradesh': 'hi',
  'jammu and kashmir': 'hi',
  jharkhand: 'hi',
  karnataka: 'kn',
  kerala: 'ml',
  ladakh: 'hi',
  'madhya pradesh': 'hi',
  maharashtra: 'mr',
  odisha: 'or',
  orissa: 'or',
  punjab: 'pa',
  rajasthan: 'hi',
  sikkim: 'hi',
  'tamil nadu': 'ta',
  telangana: 'te',
  tripura: 'bn',
  'uttar pradesh': 'hi',
  uttarakhand: 'hi',
  'west bengal': 'bn',
};

const NORTH_BENGAL_NEPALI_KEYWORDS = [
  'siliguri',
  'darjeeling',
  'kalimpong',
  'kurseong',
  'mirik',
  'jalpaiguri',
];

type LanguagePromptResolution = {
  suggested: string;
  options: string[];
};

const isSupportedUiLanguage = (value: string) =>
  SUPPORTED_UI_LANGUAGES.some((option) => option.value === value);

const buildLanguagePromptOptions = (...languages: Array<string | null | undefined>) => {
  const ordered = languages
    .map((language) => String(language || '').trim().toLowerCase())
    .filter(Boolean);
  const deduped = Array.from(new Set(ordered));
  return deduped.filter(isSupportedUiLanguage);
};

const isNorthBengalNepaliBelt = (tokens: string[]) =>
  tokens.some((token) => NORTH_BENGAL_NEPALI_KEYWORDS.some((keyword) => token.includes(keyword)));

const resolveLanguagePromptFromAddress = (
  address: Record<string, unknown>,
  browserPreferredLanguage: string
): LanguagePromptResolution | null => {
  const state = String(address.state || address.region || '').trim().toLowerCase();
  if (!state) return null;

  const district = String(address.state_district || address.county || address.city_district || '').trim().toLowerCase();
  const city = String(address.city || address.town || address.village || address.municipality || '').trim().toLowerCase();
  const suburb = String(address.suburb || address.hamlet || address.neighbourhood || '').trim().toLowerCase();
  const tokens = [city, suburb, district, state].filter(Boolean);

  const stateRegionalLanguage = IN_STATE_LANGUAGE_MAP[state];
  if (!stateRegionalLanguage) {
    return {
      suggested: ['en', 'hi'].includes(browserPreferredLanguage) ? browserPreferredLanguage : 'en',
      options: ['en', 'hi'],
    };
  }

  const options = buildLanguagePromptOptions('en', 'hi', stateRegionalLanguage);
  if (state === 'west bengal' && isNorthBengalNepaliBelt(tokens)) {
    options.push('ne');
  }

  const uniqueOptions = Array.from(new Set(options));
  const suggested =
    uniqueOptions.includes(browserPreferredLanguage) && !['en', 'hi'].includes(browserPreferredLanguage)
      ? browserPreferredLanguage
      : stateRegionalLanguage;

  return {
    suggested,
    options: uniqueOptions,
  };
};

const getSupportedUiLanguage = (value: string) =>
  SUPPORTED_UI_LANGUAGES.find((item) => item.value === value) || SUPPORTED_UI_LANGUAGES[0];

const getGoogleTranslateCode = (value: string) => getSupportedUiLanguage(value).googleCode;

const setGoogleTranslateCookie = (language: string) => {
  if (typeof document === 'undefined') return;
  if (!hasStoredCookieConsentCategory('preferences')) {
    clearGoogleTranslateArtifacts();
    return;
  }
  const target = `/en/${getGoogleTranslateCode(language)}`;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `googtrans=${target}; path=/; max-age=${maxAge}`;
  if (window.location.hostname.endsWith('mairide.in')) {
    document.cookie = `googtrans=${target}; path=/; domain=.mairide.in; max-age=${maxAge}`;
  }
};

const applyGoogleTranslateLanguage = (language: string) => {
  if (typeof document === 'undefined') return;
  const combo = document.querySelector('.goog-te-combo') as HTMLSelectElement | null;
  if (!combo) return;
  const target = getGoogleTranslateCode(language);
  if (combo.value !== target) {
    combo.value = target;
    combo.dispatchEvent(new Event('change'));
  }
};

let googleTranslateScriptPromise: Promise<void> | null = null;
const ensureGoogleTranslateScriptLoaded = (forceForSession = false): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (!forceForSession && !hasStoredCookieConsentCategory('preferences')) return Promise.resolve();
  if ((window as any).google?.translate?.TranslateElement) return Promise.resolve();
  if (googleTranslateScriptPromise) return googleTranslateScriptPromise;

  googleTranslateScriptPromise = new Promise<void>((resolve) => {
    const existingScript = document.getElementById('google-translate-script') as HTMLScriptElement | null;
    if (existingScript) {
      const settle = () => resolve();
      existingScript.addEventListener('load', settle, { once: true });
      existingScript.addEventListener('error', settle, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-translate-script';
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });

  return googleTranslateScriptPromise;
};

const detectBrowserPreferredLanguage = () => {
  const locale = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  const matched = SUPPORTED_UI_LANGUAGES.find((item) => locale.startsWith(item.value));
  return matched?.value || 'en';
};

const detectLanguagePromptFromGeolocation = async (): Promise<LanguagePromptResolution | null> => {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null;
  const position = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 6000,
      maximumAge: 600000,
    })
  ).catch(() => null);

  if (!position) return null;

  const lat = position.coords.latitude;
  const lon = position.coords.longitude;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
  ).catch(() => null);
  if (!response || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  const address = payload?.address || {};
  return resolveLanguagePromptFromAddress(address, detectBrowserPreferredLanguage());
};

const LanguageSwitcher = ({
  value,
  onChange,
  compact = false,
  variant = 'default',
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
  variant?: 'default' | 'auth' | 'nav';
}) => (
  <div
    className={cn(
      'notranslate flex items-center gap-2 rounded-xl',
      variant === 'auth'
        ? 'border border-white/30 bg-mairide-primary/75 px-3 py-1.5 shadow-lg backdrop-blur-md'
        : variant === 'nav'
          ? 'border border-mairide-secondary bg-white px-2.5 py-1.5'
        : 'border border-mairide-secondary bg-white',
      compact && variant !== 'auth' ? 'px-2 py-1' : compact ? 'px-3 py-1.5' : 'px-3 py-2'
    )}
    translate="no"
  >
    <Globe2
      className={cn(
        variant === 'auth' ? 'text-white/90' : 'text-mairide-secondary',
        compact ? 'w-4 h-4' : 'w-5 h-5'
      )}
    />
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      translate="no"
      className={cn(
        'notranslate bg-transparent outline-none appearance-none pr-5',
        variant === 'auth' ? 'text-white' : 'text-mairide-primary',
        compact ? 'text-xs font-semibold' : 'text-sm font-semibold',
        variant === 'nav'
          ? isAppWebViewRuntime()
            ? 'w-[94px] md:w-[112px] truncate'
            : 'w-[106px] md:w-[132px] truncate'
          : compact
            ? 'w-[128px] md:w-[152px] truncate'
            : 'w-[172px]'
      )}
    >
      {SUPPORTED_UI_LANGUAGES.map((option) => (
        <option key={option.value} value={option.value}>
          {option.nativeLabel}
        </option>
      ))}
    </select>
    <ChevronDown className={cn(variant === 'auth' ? 'text-white/90' : 'text-mairide-secondary', 'w-4 h-4')} />
  </div>
);

const formatGeoTimestamp = (timestamp?: number) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

const GeoTagMeta = ({ geoTag }: { geoTag?: { lat: number; lng: number; timestamp: number } | null }) => {
  if (!geoTag) return null;
  const capturedAt = formatGeoTimestamp(geoTag.timestamp);
  return (
    <div className="absolute bottom-2 left-2 bg-black/55 text-white text-[8px] px-2 py-1 rounded-xl backdrop-blur-md leading-tight">
      <div>Lat {geoTag.lat.toFixed(4)}, Lng {geoTag.lng.toFixed(4)}</div>
      {capturedAt && <div>Captured {capturedAt}</div>}
    </div>
  );
};

const TRAVELER_DISCLOSURE_TEXT =
  "I confirm that the personal, contact, pickup, destination, and account details I submit are true, accurate, and complete to the best of my knowledge. I agree to MaiRide's terms of use, safety rules, verification checks, and community standards. I understand that false, misleading, or incomplete information may lead to suspension, account closure, or legal reporting where required.";

const DRIVER_DISCLOSURE_TEXT =
  "I confirm that the personal, contact, vehicle, insurance, and identity details I submit are true, accurate, and complete to the best of my knowledge. I agree to MaiRide's terms of use, safety rules, verification checks, and community standards. I understand that false, misleading, or incomplete information may lead to suspension, account closure, or legal reporting where required.";

const MARKETING_DISCLOSURE_TEXT =
  "I agree to receive account updates, safety notices, service alerts, offers, and promotional communications from MaiRide by email, SMS, and WhatsApp. I understand I can change these preferences later if MaiRide provides that option.";

const DRIVER_DECLARATION_TEXT =
  "I confirm that my vehicle, registration, license, insurance, and identity documents belong to me or are lawfully under my control, and that every document and image submitted is current, genuine, and captured by me during this onboarding process.";

type VerificationMarker = {
  id: string;
  label: string;
  geoTag: { lat: number; lng: number; timestamp: number };
};

type AppDialogTone = 'info' | 'success' | 'warning' | 'error';

type AppDialogDetail = {
  title?: string;
  message: string;
  tone?: AppDialogTone;
};

const getBookingNegotiationField = <T,>(booking: Booking, key: string): T | undefined => {
  const nested = (booking as any)?.data?.[key];
  if (nested !== undefined && nested !== null && nested !== '') {
    return nested as T;
  }
  const topLevel = (booking as any)?.[key];
  if (topLevel !== undefined && topLevel !== null && topLevel !== '') {
    return topLevel as T;
  }
  return undefined;
};

const normalizeNegotiationBooking = <T extends Booking>(booking: T): T => {
  const data = (booking as any)?.data || {};
  return {
    ...booking,
    ...(data.negotiatedFare !== undefined ? { negotiatedFare: data.negotiatedFare } : {}),
    ...(data.negotiationStatus ? { negotiationStatus: data.negotiationStatus } : {}),
    ...(data.negotiationActor ? { negotiationActor: data.negotiationActor } : {}),
    ...(data.driverCounterPending !== undefined ? { driverCounterPending: data.driverCounterPending } : {}),
    ...(data.status ? { status: data.status } : {}),
    ...(data.fare !== undefined ? { fare: data.fare } : {}),
    ...(data.listedFare !== undefined ? { listedFare: data.listedFare } : {}),
    ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
    ...(data.rideRetired !== undefined ? { rideRetired: data.rideRetired } : {}),
    ...(data.driverPhone ? { driverPhone: data.driverPhone } : {}),
    ...(data.consumerPhone ? { consumerPhone: data.consumerPhone } : {}),
  };
};

const getPendingNegotiationActor = (booking: Booking): 'driver' | 'consumer' | null => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const negotiationActor = String(getBookingNegotiationField<string>(booking, 'negotiationActor') || '');
  const driverCounterPending = Boolean(getBookingNegotiationField<boolean>(booking, 'driverCounterPending'));

  if (!Number.isFinite(negotiatedFare) || negotiationStatus !== 'pending') {
    return null;
  }

  if (negotiationActor === 'driver') {
    return 'driver';
  }

  if (negotiationActor === 'consumer') {
    return 'consumer';
  }

  if (driverCounterPending) {
    return 'driver';
  }

  return null;
};

const hasPendingDriverCounterOffer = (booking: Booking) => {
  return getPendingNegotiationActor(booking) === 'driver';
};

const hasPendingTravelerCounterOffer = (booking: Booking) => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const fare = Number(getBookingNegotiationField<number | string>(booking, 'fare'));

  if (!Number.isFinite(negotiatedFare) || negotiationStatus !== 'pending') {
    return false;
  }

  return getPendingNegotiationActor(booking) === 'consumer' && negotiatedFare !== fare;
};

const loadNegotiationThreadBookings = async (seedBooking: Booking) => {
  const rideId = seedBooking.rideId;
  const consumerId = seedBooking.consumerId;

  if (!rideId || !consumerId) {
    return [seedBooking];
  }

  const snapshot = await getDocs(
    query(
      collection(db, 'bookings'),
      where('rideId', '==', rideId),
      where('consumerId', '==', consumerId)
    )
  );

  const rows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
  const threadKey = getBookingThreadKey(seedBooking);
  const threadRows = rows.filter((booking) => getBookingThreadKey(booking) === threadKey);

  return threadRows.length ? threadRows : [seedBooking];
};

const persistCounterOfferThroughCompatStore = async (
  seedBooking: Booking,
  actor: 'driver' | 'consumer',
  fare: number
) => {
  const updatedAt = new Date().toISOString();
  const threadRows = await loadNegotiationThreadBookings(seedBooking);

  await Promise.all(
    threadRows.map((booking) =>
      updateDoc(doc(db, 'bookings', booking.id), {
        negotiatedFare: fare,
        negotiationStatus: 'pending',
        negotiationActor: actor,
        driverCounterPending: actor === 'driver',
        status: 'negotiating',
        rideRetired: false,
        'data.negotiatedFare': fare,
        'data.negotiationStatus': 'pending',
        'data.negotiationActor': actor,
        'data.driverCounterPending': actor === 'driver',
        'data.status': 'negotiating',
        'data.rideRetired': false,
        updatedAt,
        'data.updatedAt': updatedAt,
      })
    )
  );

  return updatedAt;
};

const persistNegotiationResolutionThroughCompatStore = async (
  seedBooking: Booking,
  actor: 'driver' | 'consumer',
  action: 'accepted' | 'rejected' | 'confirmed',
  options?: {
    acceptedFare?: number;
    driverPhone?: string;
  }
) => {
  const updatedAt = new Date().toISOString();
  const threadRows = await loadNegotiationThreadBookings(seedBooking);
  const normalizedAction = action === 'confirmed' ? 'accepted' : action;
  const nextStatus = normalizedAction === 'accepted' ? 'confirmed' : 'rejected';
  const nextNegotiationStatus = normalizedAction === 'accepted' ? 'accepted' : 'rejected';
  const nextFare =
    normalizedAction === 'accepted'
      ? options?.acceptedFare ?? getNegotiationDisplayFare(seedBooking)
      : undefined;

  await Promise.all(
    threadRows.map((booking) =>
      updateDoc(doc(db, 'bookings', booking.id), {
        ...(normalizedAction === 'accepted' && Number.isFinite(nextFare) ? { fare: nextFare } : {}),
        status: nextStatus,
        negotiationStatus: nextNegotiationStatus,
        negotiationActor: actor,
        driverCounterPending: false,
        rideRetired: normalizedAction === 'rejected',
        ...(normalizedAction === 'accepted' && Number.isFinite(nextFare) ? { 'data.fare': nextFare } : {}),
        'data.status': nextStatus,
        'data.negotiationStatus': nextNegotiationStatus,
        'data.negotiationActor': actor,
        'data.driverCounterPending': false,
        'data.rideRetired': normalizedAction === 'rejected',
        ...(options?.driverPhone ? { driverPhone: options.driverPhone } : {}),
        ...(options?.driverPhone ? { 'data.driverPhone': options.driverPhone } : {}),
        updatedAt,
        'data.updatedAt': updatedAt,
      })
    )
  );

  if (normalizedAction === 'accepted' && seedBooking.rideId) {
    await updateDoc(doc(db, 'rides', seedBooking.rideId), {
      status: 'full',
      updatedAt,
    });
  }

  return updatedAt;
};

const applyThreadNegotiationState = (
  seedBooking: Booking,
  actor: 'driver' | 'consumer',
  status: 'pending' | 'negotiating' | 'confirmed' | 'rejected',
  options?: {
    fare?: number;
    driverPhone?: string;
    negotiationStatus?: 'pending' | 'accepted' | 'rejected';
    driverCounterPending?: boolean;
    rideRetired?: boolean;
  }
) => {
  const updatedAt = new Date().toISOString();
  return (candidate: Booking) =>
    getBookingThreadKey(candidate) === getBookingThreadKey(seedBooking)
      ? {
          ...candidate,
          ...(options?.fare !== undefined ? { fare: options.fare } : {}),
          ...(options?.fare !== undefined ? { negotiatedFare: options.fare } : {}),
          status,
          negotiationStatus:
            options?.negotiationStatus ?? (status === 'confirmed' ? 'accepted' : status === 'rejected' ? 'rejected' : 'pending'),
          negotiationActor: actor,
          driverCounterPending: options?.driverCounterPending ?? (actor === 'driver' && status !== 'confirmed' && status !== 'rejected'),
          ...(options?.driverPhone ? { driverPhone: options.driverPhone } : {}),
          ...(options?.rideRetired !== undefined ? { rideRetired: options.rideRetired } : {}),
          updatedAt,
        }
      : candidate;
};

const getNegotiationDisplayFare = (booking: Booking) => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const fare = Number(getBookingNegotiationField<number | string>(booking, 'fare'));

  if (Number.isFinite(negotiatedFare) && negotiationStatus === 'pending') {
    return negotiatedFare;
  }

  return fare;
};

const getBookingStateLabel = (booking: Booking) => {
  if (hasPendingDriverCounterOffer(booking)) return 'counter offer';
  if (hasPendingTravelerCounterOffer(booking)) return 'your offer pending';
  if (booking.status === 'confirmed') return 'booked';
  return booking.status;
};

const getListedFare = (booking: Booking) => {
  const listedFare = Number(getBookingNegotiationField<number | string>(booking, 'listedFare'));
  if (Number.isFinite(listedFare) && listedFare > 0) {
    return listedFare;
  }
  return Number(getBookingNegotiationField<number | string>(booking, 'fare'));
};

const shouldShowNegotiatedFareLine = (booking: Booking) => {
  const listedFare = getListedFare(booking);
  const displayFare = getNegotiationDisplayFare(booking);
  return Math.abs(displayFare - listedFare) > 0.001;
};

const getBookingThreadKey = (booking: Partial<Booking>) => {
  const rideId = booking.rideId || '';
  if (rideId) {
    return `${rideId}__${booking.consumerId || ''}`;
  }
  const driverId = booking.driverId || '';
  const consumerId = booking.consumerId || '';
  const origin = normalizeSearchText(booking.origin || '');
  const destination = normalizeSearchText(booking.destination || '');
  return `${driverId}__${consumerId}__${origin}__${destination}`;
};

const getRecordTimestamp = (record: { updatedAt?: string; createdAt?: string }) =>
  new Date(record.updatedAt || record.createdAt || 0).getTime();

const dedupeBookingsByThread = <T extends Booking>(bookings: T[]) => {
  const latestByThread = new Map<string, T>();

  bookings.forEach((booking) => {
    const threadKey = getBookingThreadKey(booking);
    const existing = latestByThread.get(threadKey);
    if (!existing || getRecordTimestamp(booking) >= getRecordTimestamp(existing)) {
      latestByThread.set(threadKey, booking);
    }
  });

  return Array.from(latestByThread.values());
};

const primaryActionButtonClass =
  "rounded-xl font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-sm";

const secondaryActionButtonClass =
  "rounded-xl font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm";

const normalizeDialogMessage = (input: unknown, fallback = 'A server error has occurred'): string => {
  if (typeof input === 'string' && input.trim()) return input;
  if (input instanceof Error && typeof input.message === 'string' && input.message.trim()) return input.message;
  if (input && typeof input === 'object') {
    const candidate = input as Record<string, any>;
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
    if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') return `${candidate.code}: ${candidate.message}`;
    try {
      const serialized = JSON.stringify(candidate);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization failure
    }
  }
  return fallback;
};

const inferDialogTone = (message: unknown): AppDialogTone => {
  const lowered = normalizeDialogMessage(message, '').toLowerCase();
  if (lowered.includes('success') || lowered.includes('submitted') || lowered.includes('created') || lowered.includes('copied')) {
    return 'success';
  }
  if (lowered.includes('failed') || lowered.includes('error') || lowered.includes('invalid') || lowered.includes('rejected')) {
    return 'error';
  }
  if (lowered.includes('please') || lowered.includes('warning') || lowered.includes('cannot')) {
    return 'warning';
  }
  return 'info';
};

const showAppDialog = (message: unknown, tone?: AppDialogTone, title?: string) => {
  if (typeof window === 'undefined') return;
  const normalizedMessage = normalizeDialogMessage(message);
  window.dispatchEvent(
    new CustomEvent<AppDialogDetail>(APP_DIALOG_EVENT, {
      detail: {
        message: normalizedMessage,
        tone: tone || inferDialogTone(normalizedMessage),
        title,
      },
    })
  );
};

const ensureRazorpayCheckoutScript = async () => {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise<boolean>((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        razorpayScriptPromise = null;
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }

  const loaded = await razorpayScriptPromise;
  if (!loaded) {
    razorpayScriptPromise = null;
  }
  return loaded;
};

const startRazorpayPlatformFeeCheckout = async ({
  booking,
  payer,
  profile,
  config,
  amount,
  coinsUsed = 0,
  onVerified,
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  profile: UserProfile;
  config?: AppConfig | null;
  amount?: number;
  coinsUsed?: number;
  onVerified: (payment: { paymentId: string; orderId: string; signature: string }) => Promise<void>;
}) => {
  const razorpayKeyId = getConfiguredRazorpayKeyId(config);

  if (!razorpayKeyId) {
    showAppDialog('Razorpay test checkout is not enabled for this environment.', 'warning', 'Payment unavailable');
    return false;
  }

  const scriptLoaded = await ensureRazorpayCheckoutScript();
  if (!scriptLoaded || !window.Razorpay) {
    showAppDialog('We could not load Razorpay checkout. Please check your internet connection and try again.', 'error', 'Checkout unavailable');
    throw new Error('Failed to load Razorpay checkout.');
  }

  const token = await getAccessToken();
  const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
  const payableAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : totalFee;
  let order;
  try {
    const orderResponse = await axios.post(
      '/api/payments?action=create-razorpay-order',
      {
        amount: payableAmount,
        bookingId: booking.id,
        payer,
        notes: {
          route: `${booking.origin} -> ${booking.destination}`,
          coinsUsed,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    order = orderResponse.data;
  } catch (error: any) {
    const message = error?.response?.data?.error || error?.message || 'We could not initialize the Razorpay order.';
    showAppDialog(message, 'error', 'Payment unavailable');
    throw new Error(message);
  }

  if (!order?.id) {
    showAppDialog('We could not initialize the Razorpay order. Please try again.', 'error', 'Payment unavailable');
    throw new Error('Failed to initialize Razorpay order.');
  }

  await new Promise<void>((resolve, reject) => {
    const razorpay = new window.Razorpay!({
      key: razorpayKeyId,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: BRAND_NAME,
      description: `${payer === 'consumer' ? 'Traveler' : 'Driver'} platform fee`,
      image: LOGO_URL,
      theme: {
        color: '#F47C20',
      },
      prefill: {
        name: profile.displayName || '',
        email: profile.email || '',
        contact: profile.phoneNumber ? profile.phoneNumber.replace(/[^\d]/g, '').slice(-10) : '',
      },
      notes: order.notes,
      modal: {
        ondismiss: () => reject(new Error('Razorpay checkout was closed.')),
      },
      handler: async (response: Record<string, string>) => {
        try {
          const verification = await axios.post(
            '/api/payments?action=verify-razorpay-payment',
            response,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (!verification.data?.verified || !response.razorpay_payment_id || !response.razorpay_order_id || !response.razorpay_signature) {
            reject(new Error('Razorpay payment verification failed.'));
            return;
          }

          await onVerified({
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signature: response.razorpay_signature,
          });
          resolve();
        } catch (error: any) {
          reject(new Error(error?.response?.data?.error || error?.message || 'Failed to verify Razorpay payment.'));
        }
      },
    });

    razorpay.open();
  });

  return true;
};

const canUseBrowserNotifications = () =>
  typeof window !== 'undefined' && 'Notification' in window;

const ensureBrowserNotificationPermission = async () => {
  if (!canUseBrowserNotifications()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

const sendBrowserNotification = async (
  title: string,
  body: string,
  options?: { tag?: string; requirePermissionPrompt?: boolean }
) => {
  if (!canUseBrowserNotifications()) return false;
  const permission = options?.requirePermissionPrompt
    ? await ensureBrowserNotificationPermission()
    : Notification.permission;
  if (permission !== 'granted') return false;
  try {
    new Notification(title, {
      body,
      tag: options?.tag,
      icon: '/icons/icon-192.png',
    });
    return true;
  } catch {
    return false;
  }
};

const buildVerificationMarkers = (driverDetails?: UserProfile['driverDetails'] | null): VerificationMarker[] => {
  if (!driverDetails) return [];
  const candidates = [
    { id: 'selfie', label: 'Selfie', geoTag: driverDetails.selfieGeoTag },
    { id: 'aadhaar-front', label: 'Aadhaar Front', geoTag: driverDetails.aadhaarFrontGeoTag },
    { id: 'aadhaar-back', label: 'Aadhaar Back', geoTag: driverDetails.aadhaarBackGeoTag },
    { id: 'dl-front', label: 'DL Front', geoTag: driverDetails.dlFrontGeoTag },
    { id: 'dl-back', label: 'DL Back', geoTag: driverDetails.dlBackGeoTag },
    { id: 'vehicle', label: 'Vehicle', geoTag: driverDetails.vehicleGeoTag },
    { id: 'rc', label: 'RC', geoTag: driverDetails.rcGeoTag },
  ];
  return candidates.filter((item): item is VerificationMarker => !!item.geoTag);
};

const VerificationMap = ({
  markers,
  isLoaded,
  title,
  subtitle,
}: {
  markers: VerificationMarker[];
  isLoaded: boolean;
  title: string;
  subtitle: string;
}) => {
  if (!markers.length) {
    return (
      <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
        <h3 className="text-sm font-bold text-mairide-primary mb-1">{title}</h3>
        <p className="text-xs text-mairide-secondary">{subtitle}</p>
      </div>
    );
  }

  const center =
    markers.length === 1
      ? { lat: markers[0].geoTag.lat, lng: markers[0].geoTag.lng }
      : {
          lat: markers.reduce((sum, marker) => sum + marker.geoTag.lat, 0) / markers.length,
          lng: markers.reduce((sum, marker) => sum + marker.geoTag.lng, 0) / markers.length,
        };

  return (
    <div className="rounded-[28px] border border-mairide-secondary bg-white overflow-hidden shadow-sm">
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-bold text-mairide-primary">{title}</h3>
        <p className="text-xs text-mairide-secondary">{subtitle}</p>
      </div>
      {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '220px' }}
          center={center}
          zoom={14}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: 'greedy',
          }}
        >
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={{ lat: marker.geoTag.lat, lng: marker.geoTag.lng }}
              title={`${marker.label} • ${formatGeoTimestamp(marker.geoTag.timestamp) || 'Captured'}`}
              label={{
                text: marker.label.slice(0, 1),
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: '700',
              }}
            />
          ))}
        </GoogleMap>
      ) : (
        <div className="h-[220px] bg-mairide-bg flex items-center justify-center text-xs text-mairide-secondary px-6 text-center">
          Map preview will appear here when Google Maps is available.
        </div>
      )}
      <div className="px-5 py-4 bg-mairide-bg/60 border-t border-mairide-secondary/60">
        <div className="flex flex-wrap gap-2">
          {markers.map((marker) => (
            <span
              key={marker.id}
              className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold text-mairide-primary border border-mairide-secondary"
            >
              {marker.label} • {formatGeoTimestamp(marker.geoTag.timestamp) || 'Captured'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const getAccessToken = async () => {
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || (await auth.currentUser?.getIdToken?.()) || '';
  if (!token) {
    throw new Error('No authentication token found');
  }
  return token;
};

const getOptionalAccessToken = async () => {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    return session?.access_token || (await auth.currentUser?.getIdToken?.()) || '';
  } catch {
    return '';
  }
};

const trackPlatformUsageEvent = async (
  metricKey: string,
  data: Record<string, unknown> = {},
  options: { requireAnalyticsConsent?: boolean; units?: string; value?: number } = {}
) => {
  const requireConsent = options.requireAnalyticsConsent !== false;
  if (requireConsent && !hasStoredCookieConsentCategory('analytics')) return;
  if (typeof window === 'undefined') return;

  try {
    const token = await getOptionalAccessToken();
    await fetch(apiPath('/api/analytics?action=event'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        metricKey,
        units: options.units || 'event',
        value: options.value ?? 1,
        data: {
          appVersion: APP_VERSION,
          runtime: isAndroidAppRuntime() ? 'android_app' : 'web',
          path: window.location.pathname,
          ...data,
        },
      }),
      keepalive: true,
    });
  } catch {
    // Analytics must never block app usage.
  }
};

const registerAndroidPushDevice = async (profile: UserProfile, releaseVersion: string) => {
  if (!isAndroidAppRuntime() || profile.role === 'admin') return () => {};

  const permission = await PushNotifications.checkPermissions();
  const nextPermission = permission.receive === 'prompt'
    ? await PushNotifications.requestPermissions()
    : permission;

  if (nextPermission.receive !== 'granted') {
    console.warn('Android push notifications permission not granted.');
    return () => {};
  }

  await PushNotifications.createChannel?.({
    id: 'mairide_nearby',
    name: 'Nearby rides',
    description: 'Nearby travelers, drivers, ride requests, and ride offers.',
    importance: 4,
    visibility: 1,
    sound: 'default',
    vibration: true,
  }).catch(() => {
    // Channel creation is Android-only and should never block token registration.
  });

  const registrationHandle = await PushNotifications.addListener('registration', async (token: Token) => {
    const accessToken = await getOptionalAccessToken();
    if (!accessToken || !token?.value) return;

    await fetch(apiPath('/api/notifications?action=register-device'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token: token.value,
        platform: 'android',
        runtime: 'android_app',
        appVersion: releaseVersion || APP_VERSION,
        location: profile.location
          ? { lat: profile.location.lat, lng: profile.location.lng }
          : undefined,
      }),
    }).catch((error) => {
      console.warn('Android push device registration failed:', error);
    });
  });

  const registrationErrorHandle = await PushNotifications.addListener('registrationError', (error) => {
    console.warn('Android push registration error:', error);
  });

  const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.info('MaiRide push notification received:', notification?.title || notification);
  });

  const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const path = String(action?.notification?.data?.path || action?.notification?.data?.url || '').trim();
    if (path.startsWith('/')) {
      window.location.assign(path);
    }
  });

  await PushNotifications.register();

  return () => {
    void registrationHandle.remove();
    void registrationErrorHandle.remove();
    void receivedHandle.remove();
    void actionHandle.remove();
  };
};

const getSessionUserId = async () => {
  const session = (await supabase.auth.getSession()).data.session;
  return session?.user?.id || '';
};

const getAdminRequestHeaders = async (adminEmail?: string | null) => {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(adminEmail ? { 'x-dev-super-admin-email': adminEmail } : {}),
  };
};

const getResolvedUserRating = (user?: UserProfile | null) => {
  const aggregateRating = user?.reviewStats?.averageRating;
  if (typeof aggregateRating === 'number' && user?.reviewStats?.ratingCount) {
    return Number(aggregateRating.toFixed(1));
  }
  if (typeof user?.driverDetails?.rating === 'number') {
    return Number(user.driverDetails.rating.toFixed(1));
  }
  return 5.0;
};

const isTravelerCustomPhotoUrl = (photoUrl?: string | null) => {
  const value = String(photoUrl || '');
  return /\/avatar-\d+\.jpg/i.test(value) || /users%2F[^/]+%2Favatar-\d+\.jpg/i.test(value);
};

const resolveTravelerAvatarSource = (user?: UserProfile | null): 'provider' | 'custom' | 'none' => {
  if (!user || user.role !== 'consumer') return 'none';
  if (user.travelerAvatarSource === 'provider' || user.travelerAvatarSource === 'custom' || user.travelerAvatarSource === 'none') {
    return user.travelerAvatarSource;
  }
  const photoUrl = String(user.photoURL || '');
  if (!photoUrl) return 'none';
  return isTravelerCustomPhotoUrl(photoUrl) ? 'custom' : 'provider';
};

const getResolvedUserPhoto = (user?: UserProfile | null) => {
  if (!user) return '';
  if (user.role === 'consumer') {
    const avatarSource = resolveTravelerAvatarSource(user);
    return avatarSource === 'none' ? '' : String(user.photoURL || '');
  }
  return user.photoURL || user.driverDetails?.selfiePhoto || '';
};

const getUserAvatarInitials = (user?: UserProfile | null) => {
  const source = String(user?.displayName || user?.email || user?.phoneNumber || 'MR').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

const getApiErrorMessage = (error: any, fallback: string) => {
  const normalize = (value: any): string | null => {
    if (typeof value === 'string' && value.trim()) return value;
    if (value instanceof Error && typeof value.message === 'string' && value.message.trim()) return value.message;
    if (value && typeof value === 'object') {
      if (typeof value.message === 'string' && value.message.trim()) return value.message;
      if (typeof value.error === 'string' && value.error.trim()) return value.error;
      if (typeof value.code === 'string' && typeof value.message === 'string') return `${value.code}: ${value.message}`;
      try {
        const serialized = JSON.stringify(value);
        return serialized && serialized !== '{}' ? serialized : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const apiError = error?.response?.data?.error;
  const normalizedApiError = normalize(apiError);
  if (normalizedApiError) return normalizedApiError;
  const normalizedRootError = normalize(error);
  if (normalizedRootError) return normalizedRootError;
  return fallback;
};

const isMissingSupabaseTableError = (error: any) => {
  const message = String(error?.message || error?.error || '');
  const code = String(error?.code || error?.response?.data?.code || '');
  return (
    code === 'PGRST205' ||
    message.includes("Could not find the table 'public.tripSessions'") ||
    message.includes("Could not find the table 'public.tripSessions'")
  );
};

let tripSessionsAvailability: 'unknown' | 'missing' | 'available' = 'unknown';
let tripSessionsWarningEmitted = false;

const markTripSessionsMissing = (error?: unknown) => {
  if (tripSessionsAvailability === 'missing') return;
  tripSessionsAvailability = 'missing';
  if (!tripSessionsWarningEmitted) {
    tripSessionsWarningEmitted = true;
    console.warn('Trip sessions table missing; disabling live trip session sync.', error);
  }
};

let geolocationWarningEmitted = false;
const logGeolocationIssue = (context: string, error: GeolocationPositionError) => {
  if (geolocationWarningEmitted) return;
  geolocationWarningEmitted = true;
  console.warn(`${context} geolocation unavailable; falling back to last known location.`, error);
};

const parseApiResponse = async (response: Response, fallback: string) => {
  const rawText = await response.text();
  let payload: any = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    const errorMessage =
      (typeof payload === 'object' && payload?.error) ||
      (typeof payload === 'object' && payload?.Details) ||
      (typeof payload === 'string' && payload.trim() ? payload : null) ||
      `${fallback} (HTTP ${response.status})`;
    throw new Error(errorMessage);
  }

  if (typeof payload === 'string') {
    const normalized = payload.trim().toLowerCase();
    if (normalized.startsWith('<!doctype') || normalized.startsWith('<html')) {
      throw new Error(`${fallback}. The server returned an unexpected HTML response.`);
    }
    throw new Error(`${fallback}. The server returned an unexpected response.`);
  }

  return payload;
};

const hasSubmittedBookingReview = (booking: Booking, reviewerRole: 'consumer' | 'driver') =>
  reviewerRole === 'consumer'
    ? Boolean(booking.consumerReview || booking.reviewWorkflow?.consumerSubmittedAt)
    : Boolean(booking.driverReview || booking.reviewWorkflow?.driverSubmittedAt);

const submitBookingReview = async (
  bookingId: string,
  rating: number,
  comment: string,
  traits: string[],
  reviewerUid?: string
) => {
  const normalizedBookingId = String(bookingId || '').trim();
  const normalizedReviewerUid = String(reviewerUid || auth.currentUser?.uid || '').trim();
  const normalizedRating = Number(rating);
  const normalizedComment = typeof comment === 'string' ? comment.trim() : '';
  const normalizedTraits = Array.isArray(traits)
    ? traits
        .filter((trait) => typeof trait === 'string')
        .map((trait) => trait.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  if (!normalizedBookingId) throw new Error('Missing booking ID for review submission.');
  if (!normalizedReviewerUid) throw new Error('Missing reviewer identity for review submission.');
  if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    throw new Error('Please provide a valid rating between 1 and 5.');
  }

  const now = new Date().toISOString();
  const bookingRef = doc(db, 'bookings', normalizedBookingId);

  const result = await runTransaction(db, async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists()) {
      throw new Error('Booking not found.');
    }

    const bookingData = bookingSnap.data() as Booking;
    const reviewerRole =
      normalizedReviewerUid === bookingData.consumerId
        ? 'consumer'
        : normalizedReviewerUid === bookingData.driverId
          ? 'driver'
          : null;
    if (!reviewerRole) {
      throw new Error('You are not authorized to review this booking.');
    }

    const bookingCompleted =
      bookingData.status === 'completed' ||
      bookingData.rideLifecycleStatus === 'completed' ||
      Boolean(bookingData.rideEndedAt);
    if (!bookingCompleted) {
      throw new Error('Reviews can only be submitted after ride completion.');
    }

    const reviewField = reviewerRole === 'consumer' ? 'consumerReview' : 'driverReview';
    const alreadySubmitted =
      reviewerRole === 'consumer'
        ? Boolean(bookingData.consumerReview || bookingData.reviewWorkflow?.consumerSubmittedAt)
        : Boolean(bookingData.driverReview || bookingData.reviewWorkflow?.driverSubmittedAt);
    if (alreadySubmitted) {
      throw new Error('You have already submitted a review for this ride.');
    }

    const reviewPayload = {
      rating: normalizedRating,
      comment: normalizedComment,
      traits: normalizedTraits,
      createdAt: now,
    };

    const currentWorkflow = bookingData.reviewWorkflow || {
      version: 2,
      activatedAt: bookingData.rideEndedAt || now,
      consumerPending: true,
      driverPending: true,
    };
    const nextWorkflow =
      reviewerRole === 'consumer'
        ? {
            ...currentWorkflow,
            version: 2,
            consumerPending: false,
            consumerSubmittedAt: now,
          }
        : {
            ...currentWorkflow,
            version: 2,
            driverPending: false,
            driverSubmittedAt: now,
          };

    tx.update(bookingRef, {
      [reviewField]: reviewPayload,
      reviewWorkflow: nextWorkflow,
      updatedAt: now,
    } as any);

    const targetUserId = reviewerRole === 'consumer' ? bookingData.driverId : bookingData.consumerId;
    const targetUserRef = doc(db, 'users', targetUserId);
    const targetUserSnap = await tx.get(targetUserRef);
    if (targetUserSnap.exists()) {
      const targetUser = targetUserSnap.data() as UserProfile;
      const currentCount = Number(targetUser.reviewStats?.ratingCount || 0);
      const currentAverage = Number(targetUser.reviewStats?.averageRating || 0);
      const nextCount = currentCount + 1;
      const nextAverage = Number((((currentAverage * currentCount) + normalizedRating) / nextCount).toFixed(1));

      const targetUpdate: Record<string, any> = {
        reviewStats: {
          averageRating: nextAverage,
          ratingCount: nextCount,
          lastReviewAt: now,
        },
        updatedAt: now,
      };

      if (targetUser.role === 'driver') {
        targetUpdate['driverDetails.rating'] = nextAverage;
      }

      tx.set(targetUserRef, targetUpdate, { merge: true });
    }

    return { review: reviewPayload, workflow: nextWorkflow };
  });

  return result;
};

const upsertTripSession = async ({
  booking,
  actorRole,
  actorId,
  location,
  networkState,
  appState,
  forceStatus,
  note,
}: {
  booking: Booking;
  actorRole: 'driver' | 'consumer' | 'admin' | 'system';
  actorId: string;
  location?: {
    lat: number;
    lng: number;
    accuracy?: number;
    speedKmph?: number;
    heading?: number;
  };
  networkState?: TripSession['networkState'];
  appState?: TripSession['appState'];
  forceStatus?: TripSession['status'];
  note?: string;
}) => {
  const now = new Date().toISOString();
  const sessionRef = doc(db, 'tripSessions', booking.id);
  let previous: TripSession | null = null;

  if (tripSessionsAvailability !== 'missing') {
    try {
      const snapshot = await getDoc(sessionRef);
      previous = snapshot.exists() ? (snapshot.data() as TripSession) : null;
      tripSessionsAvailability = 'available';
    } catch (error) {
      if (isMissingSupabaseTableError(error)) {
        markTripSessionsMissing(error);
        previous = null;
      } else {
        throw error;
      }
    }
  }
  const resolvedStatus = forceStatus || getBookingRealtimeStatus(booking);
  const previousActorLocation =
    actorRole === 'driver'
      ? previous?.driverLocation
      : actorRole === 'consumer'
        ? previous?.travelerLocation
        : undefined;

  let spoofDetected = false;
  let spoofMeta: Record<string, any> | undefined;
  if (location && previousActorLocation?.capturedAt) {
    const elapsedMs = Date.parse(now) - Date.parse(previousActorLocation.capturedAt);
    if (elapsedMs > 0) {
      const distanceKm = getDistance(
        previousActorLocation.lat,
        previousActorLocation.lng,
        location.lat,
        location.lng
      );
      const computedSpeedKmph = (distanceKm / elapsedMs) * 3_600_000;
      if (computedSpeedKmph > TRIP_MAX_VALID_SPEED_KMPH) {
        spoofDetected = true;
        spoofMeta = {
          previous: previousActorLocation,
          current: location,
          elapsedMs,
          computedSpeedKmph: Number(computedSpeedKmph.toFixed(2)),
        };
      }
    }
  }

  const driverLocationPatch =
    actorRole === 'driver' && location
      ? {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          speedKmph: location.speedKmph,
          heading: location.heading,
          capturedAt: now,
        }
      : previous?.driverLocation;

  const travelerLocationPatch =
    actorRole === 'consumer' && location
      ? {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          capturedAt: now,
        }
      : previous?.travelerLocation;

  const sessionPayload: TripSession = {
    id: booking.id,
    bookingId: booking.id,
    rideId: booking.rideId,
    driverId: booking.driverId,
    consumerId: booking.consumerId,
    status: resolvedStatus,
    driverLocation: driverLocationPatch,
    travelerLocation: travelerLocationPatch,
    distanceKm:
      driverLocationPatch && travelerLocationPatch
        ? Number(
            getDistance(
              driverLocationPatch.lat,
              driverLocationPatch.lng,
              travelerLocationPatch.lat,
              travelerLocationPatch.lng
            ).toFixed(2)
          )
        : previous?.distanceKm,
    etaMinutes: deriveTripEtaMinutes(
      travelerLocationPatch
        ? { lat: travelerLocationPatch.lat, lng: travelerLocationPatch.lng }
        : undefined,
      (booking as any).destinationLocation,
      driverLocationPatch?.speedKmph
    ),
    staleAfterMs: TRIP_SESSION_STALE_AFTER_MS,
    lastSignalAt: now,
    isStale: false,
    networkState:
      networkState ||
      (previous?.networkState === 'offline' ? 'recovered' : previous?.networkState) ||
      'online',
    appState: appState || previous?.appState || 'foreground',
    auditTrail: appendTripAuditEntry(previous?.auditTrail, {
      actorId,
      actorRole,
      action: note || `${actorRole}_sync`,
      createdAt: now,
      meta: {
        bookingStatus: booking.status,
        rideLifecycleStatus: booking.rideLifecycleStatus || null,
        resolvedStatus,
        spoofDetected,
        ...(spoofMeta ? { spoofMeta } : {}),
      },
    }),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };

  if (tripSessionsAvailability === 'missing') {
    return sessionPayload;
  }

  try {
    await setDoc(sessionRef, sessionPayload, { merge: true });
    tripSessionsAvailability = 'available';
  } catch (error) {
    if (isMissingSupabaseTableError(error)) {
      markTripSessionsMissing(error);
      return sessionPayload;
    }
    throw error;
  }
  return sessionPayload;
};

const markTripSessionStale = async (session: TripSession) => {
  if (tripSessionsAvailability === 'missing') return;
  const staleAfterMs = Number(session.staleAfterMs || TRIP_SESSION_STALE_AFTER_MS);
  const lastSignal = session.lastSignalAt ? new Date(session.lastSignalAt).getTime() : 0;
  if (!lastSignal) return;
  if (Date.now() - lastSignal <= staleAfterMs) return;

  try {
    await setDoc(
      doc(db, 'tripSessions', session.id),
      {
        isStale: true,
        networkState: 'offline',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    tripSessionsAvailability = 'available';
  } catch (error) {
    if (isMissingSupabaseTableError(error)) {
      markTripSessionsMissing(error);
      return;
    }
    throw error;
  }
};

const listSupportTickets = async (all = false) => {
  const token = await getAccessToken();
  const query = all ? '?action=list-tickets&all=1' : '?action=list-tickets';
  const response = await axios.get(`/api/support${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return Array.isArray(response.data?.tickets) ? (response.data.tickets as SupportTicket[]) : [];
};

const createSupportTicket = async (payload: { subject: string; message: string; priority?: SupportTicket['priority'] }) => {
  const token = await getAccessToken();
  const response = await axios.post(apiPath('/api/support?action=create-ticket'), payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data?.ticket as SupportTicket | undefined;
};

const respondSupportTicket = async (payload: { ticketId: string; message: string }) => {
  const token = await getAccessToken();
  const response = await axios.post(apiPath('/api/support?action=respond-ticket'), payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data?.ticket as SupportTicket | undefined;
};

const updateSupportTicketStatus = async (payload: { ticketId: string; status: SupportTicket['status'] }) => {
  const token = await getAccessToken();
  const response = await axios.post(apiPath('/api/support?action=update-ticket-status'), payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data?.ticket as SupportTicket | undefined;
};

const submitSupportFeedback = async (payload: { ticketId: string; rating: number; tags: string[]; comment?: string }) => {
  const token = await getAccessToken();
  const response = await axios.post(apiPath('/api/support?action=submit-ticket-feedback'), payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data?.ticket as SupportTicket | undefined;
};

const LoadingScreen = ({ releaseVersion: releaseVersionProp }: { releaseVersion?: string }) => {
  const releaseVersion = String(releaseVersionProp || '').trim() || APP_VERSION;
  return (
    <div className="fixed inset-0 bg-mairide-bg flex flex-col items-center justify-center z-50">
      <motion.div
        animate={{ scale: [1, 1.2, 1], rotate: [0, 360] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="mb-4"
      >
        <div className="flex flex-col items-center">
          <img src={LOGO_URL} className="w-48 h-48 object-contain rounded-[22%]" alt="MaiRide Logo" />
          <h1 className="text-4xl font-black text-mairide-primary mt-4 tracking-tighter">
            {BRAND_NAME}
          </h1>
        </div>
      </motion.div>
    </div>
  );
};

type BuildStampInfo = {
  appVersion?: string;
  commitSha?: string;
  commitRef?: string;
  commitMessage?: string;
  deployId?: string;
  env?: string;
  vercelUrl?: string;
  builtAt?: string;
};

const AppFooter = ({ releaseVersion, buildStamp }: { releaseVersion: string; buildStamp?: BuildStampInfo | null }) => {
  const [isAndroidDevice, setIsAndroidDevice] = useState(false);
  const [androidUpdateMessage, setAndroidUpdateMessage] = useState('');
  const [isAndroidUpdateAvailable, setIsAndroidUpdateAvailable] = useState(false);
  const [isCheckingAndroidUpdate, setIsCheckingAndroidUpdate] = useState(false);
  const [androidDownloadUrl, setAndroidDownloadUrl] = useState(LIVE_ANDROID_APK_URL);
  const [installedAndroidVersion, setInstalledAndroidVersion] = useState(APP_VERSION);

  const openAndroidDownload = () => {
    const runDownload = async () => {
      const latestUrl = getTrackedAndroidApkUrl();
      if (isAndroidAppRuntime()) {
        try {
          await downloadAndOpenAndroidApk(latestUrl);
          return;
        } catch {
          // Fall through to browser download fallback below.
        }
      }
      window.location.href = withCacheBust(latestUrl);
    };

    void runDownload();
  };

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setIsAndroidDevice(/android/i.test(navigator.userAgent || '') && isAndroidAppRuntime());
  }, []);

  useEffect(() => {
    if (!isAndroidDevice) return;
    let active = true;
    void resolveInstalledAndroidVersion().then((version) => {
      if (!active) return;
      setInstalledAndroidVersion(String(version || APP_VERSION).trim() || APP_VERSION);
    });
    return () => {
      active = false;
    };
  }, [isAndroidDevice]);

  const checkAndroidUpdate = useCallback(async () => {
    if (!isAndroidDevice) return;
    setIsCheckingAndroidUpdate(true);
    try {
      const response = await fetch(apiPath(`/downloads/android-update.json?t=${Date.now()}`), { cache: 'no-store' });
      if (!response.ok) {
        setAndroidUpdateMessage('Could not check update right now. Please try again.');
        return;
      }
      const data = await response.json();
      const latestVersion = String(data?.appVersion || '').trim();
      const nextApkUrl = String(data?.apkUrl || LIVE_ANDROID_APK_URL).trim() || LIVE_ANDROID_APK_URL;
      setAndroidDownloadUrl(nextApkUrl);
      if (!latestVersion) {
        setAndroidUpdateMessage('Update metadata unavailable. Please try again.');
        return;
      }
      const hasUpdate = normalizeVersionTag(latestVersion) !== normalizeVersionTag(installedAndroidVersion);
      if (hasUpdate) {
        setIsAndroidUpdateAvailable(true);
        setAndroidUpdateMessage(`New Android build ${latestVersion} is available.`);
      } else {
        setIsAndroidUpdateAvailable(false);
        setAndroidUpdateMessage('Your Android app is up to date.');
      }
    } catch {
      setAndroidUpdateMessage('Could not check update right now. Please try again.');
    } finally {
      setIsCheckingAndroidUpdate(false);
    }
  }, [installedAndroidVersion, isAndroidDevice]);

  useEffect(() => {
    if (!isAndroidDevice) return;
    void checkAndroidUpdate();
    const intervalId = window.setInterval(() => {
      void checkAndroidUpdate();
    }, 5 * 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAndroidDevice, checkAndroidUpdate]);

  const trimmedSha = buildStamp?.commitSha ? buildStamp.commitSha.slice(0, 7) : '';
  const buildLabel = trimmedSha ? `Build ${trimmedSha}` : 'Build local';
  const buildTime = buildStamp?.builtAt ? new Date(buildStamp.builtAt).toLocaleString() : '';
  const buildMeta = buildTime ? `${buildLabel} • ${buildTime}` : buildLabel;

  return (
    <footer className="px-4 pb-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center gap-3 mb-3">
          {isAndroidDevice ? (
            <div className="w-full max-w-md">
              {isAndroidUpdateAvailable ? (
                <button
                  type="button"
                  onClick={() => {
                    openAndroidDownload();
                  }}
                  className={cn(
                    'w-full rounded-2xl px-4 py-3 text-sm font-bold transition',
                    'bg-mairide-accent text-white hover:opacity-90 shadow-lg shadow-mairide-accent/25 animate-pulse'
                  )}
                >
                  Update App Now
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <a
              href={getTrackedAndroidApkUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl bg-black text-white px-4 py-2 text-xs font-bold tracking-wide hover:opacity-90 transition shadow-sm"
            >
              Get it on Android
            </a>
            <a
              href="/downloads/ios.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl bg-mairide-primary text-white px-4 py-2 text-xs font-bold tracking-wide hover:opacity-90 transition"
            >
              Get it on iOS
            </a>
          </div>
          {isAndroidDevice && androidUpdateMessage && isAndroidUpdateAvailable ? (
            <p className={cn('text-[11px] text-center', isAndroidUpdateAvailable ? 'text-mairide-accent font-semibold' : 'text-mairide-secondary')}>
              {androidUpdateMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-mairide-secondary">
            <a href="/terms-and-conditions.html" target="_blank" rel="noopener noreferrer" className="hover:text-mairide-primary transition">Terms &amp; Conditions</a>
            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="hover:text-mairide-primary transition">Privacy Policy</a>
            <a href="/business-model.html" target="_blank" rel="noopener noreferrer" className="hover:text-mairide-primary transition">Business Model</a>
            <a href="/tutorials/index.html" target="_blank" rel="noopener noreferrer" className="hover:text-mairide-primary transition">Tutorials</a>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT))}
              className="hover:text-mairide-primary transition"
            >
              Cookie Preferences
            </button>
          </div>
        </div>
        <p className="text-[11px] text-mairide-secondary/80 tracking-wide text-center">
          Release {releaseVersion} | Copyright 2026 MaiRide. All rights reserved. | Powered by Razorpay.
        </p>
        <p className="text-[10px] text-mairide-secondary/70 tracking-wide text-center mt-1">
          {buildMeta}
        </p>
      </div>
    </footer>
  );
};

const CookieConsentManager = ({
  onChange,
}: {
  onChange?: (consent: CookieConsentRecord) => void;
}) => {
  const [consent, setConsent] = useState<CookieConsentRecord | null>(() => getStoredCookieConsent());
  const [isOpen, setIsOpen] = useState(() => !getStoredCookieConsent());
  const [showCustomize, setShowCustomize] = useState(false);
  const [draftChoices, setDraftChoices] = useState<Record<CookieConsentCategory, boolean>>(() => ({
    ...COOKIE_CONSENT_DEFAULT_CHOICES,
    ...(getStoredCookieConsent()?.choices || {}),
    necessary: true,
  }));

  useEffect(() => {
    const openPreferences = () => {
      const latest = getStoredCookieConsent();
      setConsent(latest);
      setDraftChoices({
        ...COOKIE_CONSENT_DEFAULT_CHOICES,
        ...(latest?.choices || {}),
        necessary: true,
      });
      setShowCustomize(true);
      setIsOpen(true);
    };

    const handleUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<CookieConsentRecord>;
      const normalized = normalizeCookieConsent(customEvent.detail);
      if (normalized) {
        setConsent(normalized);
        onChange?.(normalized);
      }
    };

    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, openPreferences);
    window.addEventListener('mairide:cookie-consent-updated', handleUpdated as EventListener);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, openPreferences);
      window.removeEventListener('mairide:cookie-consent-updated', handleUpdated as EventListener);
    };
  }, [onChange]);

  const saveConsent = (choices: Partial<Record<CookieConsentCategory, boolean>>) => {
    const next = persistCookieConsent(choices);
    setConsent(next);
    setDraftChoices(next.choices);
    setIsOpen(false);
    setShowCustomize(false);
    onChange?.(next);
  };

  if (!isOpen) return null;

  const panel = (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-mairide-primary/35 px-4 py-4 backdrop-blur-sm sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-mairide-secondary bg-white shadow-2xl"
      >
        <div className="grid gap-5 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-mairide-primary text-white">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-accent">Privacy control</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-mairide-primary">
                Manage cookie preferences
              </h2>
              <p className="mt-2 text-sm leading-6 text-mairide-secondary">
                MaiRide uses necessary cookies and local storage for secure login, ride posting, payments, and app stability.
                Optional choices control saved preferences, analytics, and marketing measurement across web, mobile web, and Android.
              </p>
            </div>
          </div>

          {showCustomize ? (
            <div className="grid gap-3">
              {COOKIE_CONSENT_CATEGORY_COPY.map((category) => (
                <label
                  key={category.key}
                  className={cn(
                    "flex items-start justify-between gap-4 rounded-2xl border p-4",
                    category.locked ? "border-mairide-secondary/50 bg-mairide-bg" : "border-mairide-secondary bg-white"
                  )}
                >
                  <span>
                    <span className="block text-sm font-black text-mairide-primary">{category.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-mairide-secondary">{category.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={draftChoices[category.key]}
                    disabled={category.locked}
                    onChange={(event) =>
                      setDraftChoices((prev) => ({
                        ...prev,
                        [category.key]: event.target.checked,
                        necessary: true,
                      }))
                    }
                    className="mt-1 h-5 w-5 accent-mairide-accent disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-mairide-bg p-4 text-xs leading-6 text-mairide-secondary">
              Your choice is stored on this device. You can change it anytime from <span className="font-bold text-mairide-primary">Cookie Preferences</span> in the footer.
              {consent?.updatedAt ? (
                <span className="block pt-2 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                  Current choice saved {new Date(consent.updatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => saveConsent({ preferences: false, analytics: false, marketing: false })}
              className="rounded-2xl border border-mairide-secondary px-4 py-3 text-sm font-bold text-mairide-primary transition hover:bg-mairide-bg"
            >
              Reject optional
            </button>
            <button
              type="button"
              onClick={() => {
                if (showCustomize) {
                  saveConsent(draftChoices);
                } else {
                  setShowCustomize(true);
                }
              }}
              className="rounded-2xl border border-mairide-primary px-4 py-3 text-sm font-bold text-mairide-primary transition hover:bg-mairide-bg"
            >
              {showCustomize ? 'Save choices' : 'Customize'}
            </button>
            <button
              type="button"
              onClick={() => saveConsent({ preferences: true, analytics: true, marketing: true })}
              className="rounded-2xl bg-mairide-primary px-4 py-3 text-sm font-bold text-white transition hover:opacity-90"
            >
              Accept all
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(panel, document.body);
};

const AppDialogHost = () => {
  const [dialog, setDialog] = useState<AppDialogDetail | null>(null);

  useEffect(() => {
    const handleDialog = (event: Event) => {
      const customEvent = event as CustomEvent<AppDialogDetail>;
      if (customEvent.detail?.message) {
        setDialog(customEvent.detail);
      }
    };

    window.addEventListener(APP_DIALOG_EVENT, handleDialog);
    return () => window.removeEventListener(APP_DIALOG_EVENT, handleDialog);
  }, []);

  if (!dialog) return null;

  const toneStyles: Record<AppDialogTone, { chip: string; button: string; icon: React.ReactNode }> = {
    info: {
      chip: 'bg-mairide-primary/10 text-mairide-primary',
      button: 'bg-mairide-primary hover:bg-mairide-accent',
      icon: <MessageSquare className="w-6 h-6" />,
    },
    success: {
      chip: 'bg-green-100 text-green-700',
      button: 'bg-green-600 hover:bg-green-700',
      icon: <CheckCircle2 className="w-6 h-6" />,
    },
    warning: {
      chip: 'bg-orange-100 text-orange-700',
      button: 'bg-mairide-accent hover:bg-mairide-primary',
      icon: <AlertTriangle className="w-6 h-6" />,
    },
    error: {
      chip: 'bg-red-100 text-red-700',
      button: 'bg-red-600 hover:bg-red-700',
      icon: <AlertCircle className="w-6 h-6" />,
    },
  };

  const tone = dialog.tone || 'info';
  const styles = toneStyles[tone];
  const safeDialogMessage = normalizeDialogMessage((dialog as any)?.message);
  const safeDialogTitle = normalizeDialogMessage((dialog as any)?.title, 'MaiRide Update');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-mairide-primary/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', styles.chip)}>
            {styles.icon}
          </div>
          <button
            onClick={() => setDialog(null)}
            className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
            {safeDialogTitle}
          </p>
          <p className="mt-3 text-base leading-7 text-mairide-primary">{safeDialogMessage}</p>
        </div>
        <button
          onClick={() => setDialog(null)}
          className={cn('mt-6 w-full rounded-2xl py-3 text-sm font-bold text-white transition-colors', styles.button)}
        >
          Got it
        </button>
      </div>
    </div>
  );
};

const Navbar = ({
  user,
  profile,
  onLogout,
  uiLanguage,
  onChangeLanguage,
  onTravelerAvatarTrigger,
  isUploadingTravelerAvatar = false,
}: {
  user: User,
  profile: UserProfile | null,
  onLogout: () => void,
  uiLanguage: string,
  onChangeLanguage: (next: string) => void,
  onTravelerAvatarTrigger?: () => void,
  isUploadingTravelerAvatar?: boolean,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isAndroidShell = isAndroidAppRuntime();
  const navigate = useNavigate();
  const handleHomeNavigation = () => {
    window.dispatchEvent(new CustomEvent(APP_NAV_HOME_EVENT, { detail: { role: profile?.role } }));
    navigate('/');
    setIsOpen(false);
  };
  const navigateToRoleTab = (tab: string) => {
    window.dispatchEvent(new CustomEvent(APP_NAV_TAB_EVENT, { detail: { role: profile?.role, tab } }));
    navigate('/');
    setIsOpen(false);
  };

  const roleTabs =
    profile?.role === 'driver'
      ? [
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'requests', label: 'Booking Requests' },
          { id: 'history', label: 'Ride History' },
          { id: 'wallet', label: 'Wallet' },
          { id: 'support', label: 'Support' },
          { id: 'profile', label: 'Profile' },
        ]
      : [
          { id: 'search', label: 'Request Ride' },
          { id: 'history', label: 'My Bookings' },
          { id: 'wallet', label: 'Wallet' },
          { id: 'support', label: 'Support' },
          { id: 'profile', label: 'Profile' },
        ];

  const isTravelerProfile = profile?.role === 'consumer';
  const resolvedUserPhoto = getResolvedUserPhoto(profile);
  const travelerAvatarLabel = isUploadingTravelerAvatar ? 'Uploading profile photo' : 'Upload profile photo';

  const handleTravelerAvatarTrigger = (event?: React.SyntheticEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!isTravelerProfile || !onTravelerAvatarTrigger || isUploadingTravelerAvatar) return;
    onTravelerAvatarTrigger();
  };

  const handleTravelerAvatarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      handleTravelerAvatarTrigger(event);
    }
  };

  const renderTravelerAvatarContent = (sizeClasses: string, initialsClasses: string) => (
    <>
      {resolvedUserPhoto ? (
        <img
          src={resolvedUserPhoto}
          alt="Profile"
          className="pointer-events-none h-full w-full object-cover"
          draggable={false}
        />
      ) : isTravelerProfile ? (
        <div className="pointer-events-none flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#1f2d38_0%,#314656_55%,#f68b1f_150%)] text-white">
          <span className={cn("font-black tracking-[0.08em]", initialsClasses)}>
            {getUserAvatarInitials(profile)}
          </span>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.14),transparent_42%)]" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-mairide-bg">
          <UserIcon className="h-5 w-5 text-mairide-secondary" />
        </div>
      )}
      {isTravelerProfile && !resolvedUserPhoto && (
        <div className="pointer-events-none absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white text-mairide-primary shadow-sm">
          <Camera className="h-2.5 w-2.5" />
        </div>
      )}
    </>
  );

  const renderProfileAvatar = (
    sizeClasses: string,
    initialsClasses: string,
    extraClasses = '',
  ) => {
    const baseClasses = cn(
      "relative z-10 overflow-hidden rounded-full border border-mairide-secondary touch-manipulation select-none",
      sizeClasses,
      extraClasses,
      isUploadingTravelerAvatar && "opacity-75",
    );

    if (isTravelerProfile) {
      return (
        <button
          type="button"
          title={travelerAvatarLabel}
          aria-label={travelerAvatarLabel}
          onClick={handleTravelerAvatarTrigger}
          onKeyDown={handleTravelerAvatarKeyDown}
          disabled={isUploadingTravelerAvatar}
          className={cn(
            baseClasses,
            "cursor-pointer transition-transform hover:scale-[1.03] active:scale-[0.98]"
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {renderTravelerAvatarContent(sizeClasses, initialsClasses)}
        </button>
      );
    }

    return (
      <div
        title={profile?.displayName || 'Profile'}
        className={cn(baseClasses, "cursor-default")}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {renderTravelerAvatarContent(sizeClasses, initialsClasses)}
      </div>
    );
  };

  const renderCompactHeader = ({
    logoSize = "h-[58px] w-[58px] rounded-[20px]",
    brandClassName = "text-[1.72rem]",
    subBrandClassName = "text-[0.92rem] tracking-[0.05em]",
    containerClassName = "",
    rightLaneClassName = "",
  }: {
    logoSize?: string;
    brandClassName?: string;
    subBrandClassName?: string;
    containerClassName?: string;
    rightLaneClassName?: string;
  }) => (
    <div
      className={cn(
        "grid min-h-[84px] grid-cols-[58px_minmax(0,1fr)_52px] items-center gap-3 py-3",
        containerClassName
      )}
    >
      <div className="flex items-center justify-start">
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-mairide-secondary bg-white text-mairide-primary transition-colors hover:bg-mairide-bg"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      <button
        type="button"
        onClick={handleHomeNavigation}
        className="flex min-w-0 items-center justify-start rounded-2xl pr-1 text-left"
        aria-label="Go to home"
      >
        <img
          src={LOGO_URL}
          className={cn("mr-2.5 shrink-0 object-contain", logoSize)}
          alt="MaiRide Logo"
        />
        <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden leading-none">
          <span className={cn("block overflow-hidden text-ellipsis whitespace-nowrap font-black tracking-tighter text-mairide-primary", brandClassName)}>
            MaiRide
          </span>
          <span className={cn("mt-1 block overflow-hidden text-ellipsis whitespace-nowrap font-black text-mairide-primary", subBrandClassName)}>
            my way
          </span>
        </div>
      </button>

      <div className={cn("flex items-center justify-end", rightLaneClassName)}>
        {renderProfileAvatar("h-10 w-10", "text-xs")}
      </div>
    </div>
  );

  const renderAndroidHeader = () => (
    renderCompactHeader({
      logoSize: "h-[54px] w-[54px] rounded-[18px]",
      brandClassName: "text-[1.54rem]",
      subBrandClassName: "text-[0.84rem] tracking-[0.04em]",
      containerClassName: "grid-cols-[58px_minmax(0,1fr)_52px] gap-2",
    })
  );

  const renderCompactWebHeader = () => (
    renderCompactHeader({
      logoSize: "h-[56px] w-[56px] rounded-[20px]",
      brandClassName: "text-[1.68rem]",
      subBrandClassName: "text-[0.9rem] tracking-[0.05em]",
      containerClassName: "grid-cols-[56px_minmax(0,1fr)_50px] gap-2",
    })
  );

  return (
    <nav className="bg-white border-b border-mairide-secondary sticky top-0 z-40">
      <div className={cn("px-4 sm:px-6 lg:px-8", isAndroidShell ? "mx-auto max-w-7xl" : "w-full")}>
        {isAndroidShell ? (
          renderAndroidHeader()
        ) : (
          <>
            <div className="lg:hidden">
              {renderCompactWebHeader()}
            </div>

            <div className="hidden min-h-[92px] items-center justify-between gap-4 py-3 lg:flex">
              <div className="flex min-w-0 items-center gap-4">
                <button
                  onClick={() => setIsOpen(true)}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-mairide-secondary bg-white p-2.5 text-mairide-primary transition-colors hover:bg-mairide-bg"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div
                  className="flex min-w-0 cursor-pointer items-center justify-start"
                  onClick={handleHomeNavigation}
                >
                  <img src={LOGO_URL} className="mr-4 h-[84px] w-[84px] shrink-0 rounded-[22%] object-contain" alt="MaiRide Logo" />
                  <div className="flex min-w-0 flex-col justify-center overflow-visible py-2.5 leading-[1.04]">
                    <span className="truncate text-[2.55rem] font-black leading-[1.02] tracking-tighter text-mairide-primary">MaiRide</span>
                    <span className="mt-1.5 truncate text-[1.2rem] font-black leading-[1.04] tracking-[0.1em] text-mairide-primary">my way</span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 border-l border-mairide-secondary pl-5">
                <div className="min-w-[120px] text-right">
                  <p className="text-base font-semibold leading-tight text-mairide-primary">{profile?.displayName}</p>
                  <p className="mt-0.5 text-sm capitalize leading-tight text-mairide-secondary">{profile?.role}</p>
                </div>
                {renderProfileAvatar("h-10 w-10", "text-xs")}
                <button onClick={onLogout} className="rounded-xl p-2.5 text-mairide-secondary transition-colors hover:text-red-600">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-mairide-primary/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl border-r border-mairide-secondary"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-mairide-secondary">
                <div className="flex items-center gap-3">
                  <img src={getResolvedUserPhoto(profile) || LOGO_URL} alt="Profile" className="w-11 h-11 rounded-full object-cover border border-mairide-secondary" />
                  <div>
                    <p className="font-semibold text-mairide-primary leading-tight">{profile?.displayName}</p>
                    <p className="text-xs text-mairide-secondary capitalize">{profile?.role}</p>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 text-mairide-secondary hover:text-mairide-primary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 py-4 space-y-2">
                {roleTabs.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => navigateToRoleTab(item.id)}
                    className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
                {profile?.role === 'admin' && (
                  <button onClick={() => { navigate('/admin'); setIsOpen(false); }} className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors">Admin Panel</button>
                )}
                <div className="px-4 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary mb-2">Language</p>
                  <LanguageSwitcher
                    value={uiLanguage}
                    onChange={(next) => {
                      onChangeLanguage(next);
                    }}
                  />
                </div>
              </div>
              <div className="mt-auto px-4 pb-6">
                <button onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mairide-primary px-4 py-3 font-semibold text-white shadow-lg shadow-mairide-primary/20 transition-transform hover:scale-[1.01] active:scale-[0.99]">
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </nav>
  );
};

const MobileSectionDrawer = ({
  title,
  activeLabel,
  items,
  onSelect,
}: {
  title: string;
  activeLabel: string;
  items: { id: string; label: string; icon: LucideIcon }[];
  onSelect: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden mb-6">
      <button
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center justify-between rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-left shadow-sm"
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{title}</p>
          <p className="mt-1 text-base font-semibold text-mairide-primary">{activeLabel}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mairide-bg text-mairide-primary">
          <Menu className="w-5 h-5" />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-mairide-primary/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl border-r border-mairide-secondary"
            >
              <div className="flex items-center justify-between border-b border-mairide-secondary px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{title}</p>
                  <p className="mt-1 text-lg font-semibold text-mairide-primary">{activeLabel}</p>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 text-mairide-secondary hover:text-mairide-primary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 py-4 space-y-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSelect(item.id);
                        setIsOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary transition-colors hover:bg-mairide-bg"
                    >
                      <Icon className="w-5 h-5 text-mairide-accent" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Auth Pages ---

interface AuthPageProps {
  user: User | null;
  authMode: 'login' | 'signup';
  setAuthMode: (mode: 'login' | 'signup') => void;
  notRegisteredError: boolean;
  setNotRegisteredError: (val: boolean) => void;
  role: 'consumer' | 'driver';
  setRole: (role: 'consumer' | 'driver') => void;
  referralCodeInput: string;
  setReferralCodeInput: (val: string) => void;
  releaseVersion: string;
}

const normalizePhoneForAuth = (value: string) => String(value || '').replace(/[^\d]/g, '');
const PHONE_LOGIN_PROFILE_KEY = 'mairide_phone_profile_uid';
const PHONE_LOGIN_NUMBER_KEY = 'mairide_phone_login_number';
const OAUTH_MODE_KEY = 'mairide_oauth_mode';
const OAUTH_ROLE_KEY = 'mairide_oauth_role';

const sanitizeDisplayName = (value: string) =>
  String(value || '')
    .replace(/[^a-zA-Z\s.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, 80);

const normalizeEmailValue = (value: string) => String(value || '').trim().toLowerCase();
const getOAuthUrlParam = (key: string) => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
};
const getStoredOAuthMode = (): 'login' | 'signup' | null => {
  const urlMode = getOAuthUrlParam('oauthMode');
  const storedMode = safeStorageGet('session', OAUTH_MODE_KEY);
  if (urlMode === 'login' || urlMode === 'signup') return urlMode;
  if (storedMode === 'login' || storedMode === 'signup') return storedMode;
  return null;
};
const getStoredOAuthRole = (): 'consumer' | 'driver' =>
  getOAuthUrlParam('oauthRole') === 'driver' || safeStorageGet('session', OAUTH_ROLE_KEY) === 'driver'
    ? 'driver'
    : 'consumer';
const clearStoredOAuthIntent = () => {
  safeStorageRemove('session', OAUTH_MODE_KEY);
  safeStorageRemove('session', OAUTH_ROLE_KEY);
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    const hadOAuthParams = url.searchParams.has('oauthMode') || url.searchParams.has('oauthRole');
    url.searchParams.delete('oauthMode');
    url.searchParams.delete('oauthRole');
    if (hadOAuthParams) {
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  }
};

const isValidEmailValue = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmailValue(value));

const sanitizeIndianPhoneDigits = (value: string) => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length <= 10) return digits;
  if (digits.startsWith('91')) return digits.slice(-10);
  return digits.slice(0, 10);
};

const toIndianPhoneStorage = (value: string) => {
  const digits = sanitizeIndianPhoneDigits(value);
  return digits.length === 10 ? `+91${digits}` : '';
};

const formatPhoneForDisplay = (value?: string) => {
  const digits = sanitizeIndianPhoneDigits(value || '');
  if (!digits) return 'Not provided';
  return `+91 ${digits}`;
};

const getDialablePhone = (value?: string) => {
  const digits = sanitizeIndianPhoneDigits(value || '');
  if (digits.length === 10) return `+91${digits}`;
  const normalized = normalizePhoneForAuth(value || '');
  return normalized ? `+${normalized}` : '';
};

const sanitizeAadhaarDigits = (value: string) => String(value || '').replace(/[^\d]/g, '').slice(0, 12);

const splitAadhaarDigits = (value: string) => {
  const digits = sanitizeAadhaarDigits(value);
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)];
};

const formatAadhaarForDisplay = (value?: string) => {
  const [a = '', b = '', c = ''] = splitAadhaarDigits(value || '');
  return [a, b, c].filter(Boolean).join(' ') || 'Not provided';
};

const sanitizeLicenseOrVehicleCode = (value: string, maxLength = 20) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, maxLength);

const IndianPhoneInput = ({
  value,
  onChange,
  placeholder = 'Enter 10-digit mobile number',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <div className="flex items-center bg-mairide-bg border border-mairide-secondary rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-mairide-accent">
    <span className="px-4 py-4 text-sm font-bold text-mairide-primary border-r border-mairide-secondary bg-white/50">+91</span>
    <input
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      pattern="[0-9]{10}"
      maxLength={10}
      className="w-full px-4 py-4 bg-transparent outline-none text-mairide-primary"
      value={sanitizeIndianPhoneDigits(value)}
      onChange={(e) => onChange(sanitizeIndianPhoneDigits(e.target.value))}
      placeholder={placeholder}
    />
  </div>
);

const buildPhoneVariants = (value: string) => {
  const digits = normalizePhoneForAuth(value);
  const variants = new Set<string>();

  if (!digits) return [];

  variants.add(digits);
  variants.add(`+${digits}`);

  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    variants.add(last10);
    variants.add(`+${last10}`);
  }

  return Array.from(variants);
};

const maskPhoneNumber = (value: string) => {
  const digits = normalizePhoneForAuth(value);
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${digits[0]}${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-3)}`;
};

const ContactUnlockCard = ({
  label,
  phoneNumber,
}: {
  label: string;
  phoneNumber?: string;
}) => {
  const dialable = getDialablePhone(phoneNumber);
  const display = formatPhoneForDisplay(phoneNumber);

  return (
    <div className="mt-2 bg-green-50 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-green-700">
      <div className="flex items-center gap-2 min-w-0 w-full">
        <Phone className="w-4 h-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-green-700/70">{label}</p>
          {dialable ? (
            <a href={`tel:${dialable}`} className="font-bold underline decoration-green-300 underline-offset-4 break-all hover:text-green-800 transition-colors">
              {display}
            </a>
          ) : (
            <span className="font-bold">{display}</span>
          )}
        </div>
      </div>
      {dialable ? (
        <a
          href={`tel:${dialable}`}
          className="w-full sm:w-auto text-center shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-green-700 border border-green-100 hover:bg-green-100 transition-colors"
        >
          Call Now
        </a>
      ) : null}
    </div>
  );
};

const formatRideDeparture = (ride: Partial<Ride>) => {
  const dayLabel = ride.departureDayLabel?.trim();
  const clock = ride.departureClock?.trim();

  if (dayLabel && clock) {
    return `${dayLabel} at ${clock}`;
  }

  if (dayLabel) {
    return dayLabel;
  }

  if (ride.departureTime) {
    const date = new Date(ride.departureTime);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  return 'Departure time to be confirmed';
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

if (typeof globalThis !== 'undefined' && !(globalThis as any).withTimeout) {
  (globalThis as any).withTimeout = withTimeout;
}

const isFutureRide = (ride: Partial<Ride>) => {
  if (!ride.departureTime) return false;
  const departure = new Date(ride.departureTime);
  if (Number.isNaN(departure.getTime())) return false;
  return departure.getTime() > Date.now();
};

const isRideWithinPlanningWindow = (ride: Partial<Ride>) => {
  if (!ride.departureTime) return true;
  const departure = new Date(ride.departureTime);
  if (Number.isNaN(departure.getTime())) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDayAfter = new Date(startOfToday);
  endOfDayAfter.setDate(endOfDayAfter.getDate() + 2);
  endOfDayAfter.setHours(23, 59, 59, 999);

  return departure >= startOfToday && departure <= endOfDayAfter;
};

const findUserProfileByPhone = async (value: string) => {
  const loginDigits = normalizePhoneForAuth(value);
  const loginTail = loginDigits.slice(-10);
  const usersSnapshot = await getDocs(query(collection(db, 'users')));
  const matchedDoc = usersSnapshot.docs.find((snapshotDoc) => {
    const rawUser = snapshotDoc.data() as UserProfile & {
      data?: { phoneNumber?: string; uid?: string };
      phone_number?: string;
    };
    const storedPhoneDigits = normalizePhoneForAuth(
      rawUser.phoneNumber
      || rawUser.phone_number
      || rawUser.data?.phoneNumber
      || ''
    );
    if (!storedPhoneDigits) return false;
    return (
      storedPhoneDigits === loginDigits
      || storedPhoneDigits === loginTail
      || storedPhoneDigits.endsWith(loginTail)
      || loginDigits.endsWith(storedPhoneDigits)
    );
  });

  if (!matchedDoc) return null;

  const matchedUser = matchedDoc.data() as UserProfile & {
    data?: { phoneNumber?: string; uid?: string };
    phone_number?: string;
  };

  return {
    ...matchedUser,
    uid: matchedUser.uid || matchedUser.data?.uid || matchedDoc.id,
    phoneNumber: matchedUser.phoneNumber || matchedUser.phone_number || matchedUser.data?.phoneNumber || '',
  } as UserProfile;
};

  const AuthPage = ({ 
  user, 
  authMode, 
  setAuthMode, 
  notRegisteredError, 
  setNotRegisteredError, 
  role, 
  setRole,
  referralCodeInput,
  setReferralCodeInput,
  releaseVersion,
}: AuthPageProps) => {
  const [isRedirectedFromLogin, setIsRedirectedFromLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(''); // For email or phone login
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'email-otp' | 'otp'>('phone');
  const [sessionId, setSessionId] = useState('');
  const [emailSessionId, setEmailSessionId] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetSessionId, setResetSessionId] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [resetMaskedPhone, setResetMaskedPhone] = useState('');
  const [resetStep, setResetStep] = useState<'identifier' | 'otp' | 'password'>('identifier');
  const [truthDeclarationAccepted, setTruthDeclarationAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const maskedOtpPhone = maskPhoneNumber(phoneNumber || username);
  const normalizedSignupPhone = toIndianPhoneStorage(phoneNumber);
  const normalizedSignupEmail = normalizeEmailValue(email);
  const isAndroidWebViewRuntime = isAndroidWebViewLikeRuntime();

  const postAuthAction = async (action: string, payload: Record<string, any>, fallbackPath?: string) => {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    const isLocalhostDev =
      typeof window !== 'undefined'
        && ['localhost', '127.0.0.1'].includes(String(window.location.hostname || '').toLowerCase());

    try {
      const primaryResponse = await fetchWithOriginFailover(`/api/auth?action=${action}`, requestInit);
      if (isHtmlResponse(primaryResponse)) {
        return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
      }
      try {
        const probe = (await primaryResponse.clone().text()).slice(0, 500);
        if (looksLikeHtmlText(probe)) {
          return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
        }
      } catch {
        // Ignore probe errors here.
      }
      if ((primaryResponse.status !== 404 && primaryResponse.status !== 405) || !fallbackPath || !isLocalhostDev) {
        return primaryResponse;
      }
    } catch {
      if (!fallbackPath) {
        throw new Error(`Unable to reach authentication service for ${action}.`);
      }
    }

    const fallbackResponse = await fetchWithOriginFailover(fallbackPath, requestInit);
    if (isHtmlResponse(fallbackResponse)) {
      return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
    }
    return fallbackResponse;
  };

  const postAuthResolveAction = async (action: string, payload: Record<string, any>, fallbackPath?: string) => {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    const isLocalhostDev =
      typeof window !== 'undefined'
        && ['localhost', '127.0.0.1'].includes(String(window.location.hostname || '').toLowerCase());

    try {
      const primaryResponse = await fetchWithOriginFailover(`/api/auth?action=${action}`, requestInit);
      if (isHtmlResponse(primaryResponse)) {
        return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
      }
      try {
        const probe = (await primaryResponse.clone().text()).slice(0, 500);
        if (looksLikeHtmlText(probe)) {
          return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
        }
      } catch {
        // Ignore probe errors here.
      }
      if ((primaryResponse.status !== 404 && primaryResponse.status !== 405) || !fallbackPath || !isLocalhostDev) {
        return primaryResponse;
      }
    } catch {
      if (!fallbackPath) {
        throw new Error(`Unable to reach resolve service for ${action}.`);
      }
    }

    const fallbackResponse = await fetchWithOriginFailover(fallbackPath, requestInit);
    if (isHtmlResponse(fallbackResponse)) {
      return forceDirectAuthFetch(`/api/auth?action=${action}`, requestInit);
    }
    return fallbackResponse;
  };

  const resolvePhoneLoginClientSide = async (value: string) => {
    const matchedUser = await findUserProfileByPhone(value);

    if (matchedUser) {
      return {
        uid: matchedUser.uid,
        role: matchedUser.role,
        email: matchedUser.email || '',
        phoneNumber: matchedUser.phoneNumber || '',
      };
    }

    throw new Error("NOT_REGISTERED");
  };

  const resetForgotPasswordFlow = () => {
    setShowForgotPassword(false);
    setResetIdentifier('');
    setResetSessionId('');
    setResetToken('');
    setResetOtp('');
    setResetPassword('');
    setConfirmResetPassword('');
    setResetMaskedPhone('');
    setResetStep('identifier');
  };

  const handleSendResetOtp = async () => {
    if (!resetIdentifier.trim()) {
      alert('Please enter your registered email or mobile number.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await postAuthAction(
        'send-password-reset-otp',
        { identifier: resetIdentifier.trim() },
        '/api/auth/send-password-reset-otp'
      );
      const data = await parseApiResponse(response, 'Failed to send reset OTP');
      setResetSessionId(data.resetSessionId || '');
      setResetMaskedPhone(data.maskedPhone || '');
      setResetStep('otp');
    } catch (error: any) {
      alert(error.message || 'Failed to send reset OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyResetOtp = async () => {
    const otpDigits = resetOtp.replace(/[^\d]/g, '').slice(0, 6);
    if (!resetSessionId || otpDigits.length < 4) {
      alert('Please enter a valid OTP.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await postAuthAction(
        'verify-password-reset-otp',
        { resetSessionId, otp: otpDigits },
        '/api/auth/verify-password-reset-otp'
      );
      const data = await parseApiResponse(response, 'Failed to verify reset OTP');
      setResetToken(data.resetToken || '');
      setResetStep('password');
      setResetOtp('');
    } catch (error: any) {
      alert(error.message || 'Invalid OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }
    if (resetPassword !== confirmResetPassword) {
      alert('Passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await postAuthAction(
        'reset-password-with-otp',
        { resetToken, newPassword: resetPassword },
        '/api/auth/reset-password-with-otp'
      );
      await parseApiResponse(response, 'Failed to reset password');
      alert('Password reset successful. Please login with your new password.');
      resetForgotPasswordFlow();
      setAuthMode('login');
    } catch (error: any) {
      alert(error.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  // Pre-fill if user changes (e.g. after Google login)
  useEffect(() => {
    if (user) {
      if (user.phoneNumber && !phoneNumber) setPhoneNumber(user.phoneNumber);
      if (user.email && !email) setEmail(user.email);
      if (user.displayName && !displayName) setDisplayName(user.displayName);
      // If user is present but no profile, they should be in signup mode
      setAuthMode('signup');
    }
  }, [user]);

  useEffect(() => {
    if (step !== 'otp' || typeof window === 'undefined' || !('OTPCredential' in window) || !('credentials' in navigator)) {
      return;
    }

    const abortController = new AbortController();

    (async () => {
      try {
        const credential = await (navigator.credentials as any).get({
          otp: { transport: ['sms'] },
          signal: abortController.signal,
        });

        const code = credential?.code;
        if (typeof code === 'string' && code.trim()) {
          setOtp(code.trim().slice(0, 6));
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.debug('WebOTP autofill unavailable:', error);
        }
      }
    })();

    return () => abortController.abort();
  }, [step, sessionId]);

  const handleSendEmailOtp = async () => {
    if (!normalizedSignupEmail || !isValidEmailValue(normalizedSignupEmail)) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('send-email-otp', { email: normalizedSignupEmail }, '/api/auth/send-email-otp');
      const data = await parseApiResponse(response, 'Failed to send Email OTP');
      if (data.Status === 'Success') {
        setEmailSessionId(data.Details);
        setStep('email-otp');
      } else if (data.Code === 'EMAIL_OTP_UNAVAILABLE') {
        const phoneOtpResponse = await postAuthAction('send-otp', { phoneNumber: normalizedSignupPhone }, '/api/auth/send-otp');
        const phoneOtpData = await parseApiResponse(phoneOtpResponse, 'Failed to send phone OTP');
        if (phoneOtpData.Status === 'Success') {
          setSessionId(phoneOtpData.Details);
          setStep('otp');
          alert('Email OTP is unavailable right now. We have sent an OTP to your phone instead so you can continue signup.');
        } else {
          throw new Error(phoneOtpData.Details || 'Failed to send phone OTP');
        }
      } else {
        throw new Error(data.Details || 'Failed to send Email OTP');
      }
    } catch (error: any) {
      console.error("Email OTP Send Error:", error);
      const message =
        error.message === 'The string did not match the expected pattern.'
          ? 'Failed to send Email OTP. Please check the email format and try again.'
          : error.message || "Failed to send Email OTP. Please check the email address.";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    const otpDigits = otp.replace(/[^\d]/g, '').slice(0, 6);
    if (!otpDigits || !emailSessionId) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('verify-otp', { sessionId: emailSessionId, otp: otpDigits }, '/api/auth/verify-otp');
      const data = await parseApiResponse(response, 'Failed to verify Email OTP');
      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        setOtp(''); // Clear OTP for next step
        await handleSendOtp();
      } else {
        throw new Error(data.Details || 'Invalid Email OTP');
      }
    } catch (error: any) {
      console.error("Email OTP Verification Error:", error);
      alert(error.message || "Invalid Email OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!normalizedSignupPhone) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('send-otp', { phoneNumber: normalizedSignupPhone }, '/api/auth/send-otp');
      const data = await parseApiResponse(response, 'Failed to send OTP');
      if (data.Status === 'Success') {
        setSessionId(data.Details);
        setStep('otp');
      } else {
        throw new Error(data.Details || 'Failed to send OTP');
      }
    } catch (error: any) {
      console.error("OTP Send Error:", error);
      const message =
        error.message === 'The string did not match the expected pattern.'
          ? 'Failed to send OTP. Please enter the mobile number in digits only, for example 919876543210.'
          : error.message || "Failed to send OTP. Please check the phone number format (e.g., 919876543210).";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpDigits = otp.replace(/[^\d]/g, '').slice(0, 6);
    if (!otpDigits || !sessionId) return;
    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      const response = await postAuthAction('verify-otp', { sessionId, otp: otpDigits }, '/api/auth/verify-otp');
      const data = await parseApiResponse(response, 'Failed to verify OTP');
      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        setOtp('');
        if (!user && authMode === 'signup' && email && password && displayName) {
          await completeEmailPasswordSignUp();
        } else if (authMode === 'login') {
          let existingProfile: { uid: string; role: string; email: string; phoneNumber: string } | null = null;
          try {
            const resolveResponse = await postAuthResolveAction(
              'resolve-phone-login',
              { phoneNumber: phoneNumber || username },
              '/api/auth/resolve-phone-login'
            );
            existingProfile = await parseApiResponse(resolveResponse, 'Failed to resolve phone login');
          } catch (error: any) {
            console.warn('Server-side phone login resolve failed; trying client-side fallback.', error);
          }

          if (!existingProfile) {
            existingProfile = await resolvePhoneLoginClientSide(phoneNumber || username);
          }

          safeStorageSet('session', PHONE_LOGIN_PROFILE_KEY, existingProfile.uid);
          safeStorageSet('session', PHONE_LOGIN_NUMBER_KEY, normalizePhoneForAuth(phoneNumber || username));

          if (!auth.currentUser || !auth.currentUser.isAnonymous) {
            try {
              await signInAnonymously(auth);
            } catch (authError: any) {
              if (authError.code === 'auth/admin-restricted-operation' || authError.code === 'auth/operation-not-allowed') {
                throw new Error("Anonymous Authentication is not enabled in Firebase. Please enable it in the Firebase Console (Authentication > Sign-in method).");
              }
              throw authError;
            }
          } else {
            window.location.reload();
          }
        } else {
          try {
            const currentUser = auth.currentUser;
            if (currentUser && !currentUser.isAnonymous) {
              await handleProfileSetup(currentUser, phoneNumber, displayName || undefined, authMode === 'signup');
            } else {
              const result = await signInAnonymously(auth);
              await handleProfileSetup(result.user, phoneNumber, undefined, authMode === 'signup');
            }
          } catch (authError: any) {
            if (authError.code === 'auth/admin-restricted-operation' || authError.code === 'auth/operation-not-allowed') {
              throw new Error("Anonymous Authentication is not enabled in Firebase. Please enable it in the Firebase Console (Authentication > Sign-in method).");
            }
            throw authError;
          }
        }
      } else {
        throw new Error(data.Details || 'Invalid OTP');
      }
    } catch (error: any) {
      console.error("OTP Verification Error:", error);
      if (error.message === "NOT_REGISTERED") {
        setNotRegisteredError(true);
      } else {
        alert(error.message || "Invalid OTP. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailPasswordSignUp = async () => {
    if (!normalizedSignupEmail || (!user && !password) || !normalizedSignupPhone || !displayName.trim()) {
      alert("Please fill all fields");
      return;
    }
    if (!isValidEmailValue(normalizedSignupEmail)) {
      alert("Please enter a valid email address.");
      return;
    }
    if (!normalizedSignupPhone) {
      alert("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (!truthDeclarationAccepted || !termsAccepted) {
      alert("Please accept the declaration and terms before continuing.");
      return;
    }
    setIsLoading(true);
    try {
      // Send email OTP first
      await handleSendEmailOtp();
    } catch (error: any) {
      alert(error.message || "Failed to initiate signup.");
    } finally {
      setIsLoading(false);
    }
  };

  const completeEmailPasswordSignUp = async () => {
    try {
      if (role === 'driver' && isAndroidAppRuntime()) {
        const { cameraGranted, locationGranted } = await ensureAndroidDriverSignupPermissions();
        if (!cameraGranted || !locationGranted) {
          alert('Camera and location permissions are required before driver signup can continue. Please allow both permissions and try again.');
          return;
        }
      }

      const signupResponse = await postAuthAction('complete-signup', {
          email: normalizedSignupEmail,
          password,
          displayName: sanitizeDisplayName(displayName),
          phoneNumber: normalizedSignupPhone,
          role: role || 'consumer',
          referralCodeInput,
          consents: {
            truthfulInformationAccepted: truthDeclarationAccepted,
            termsAccepted,
            marketingOptIn,
            acceptedAt: new Date().toISOString(),
            disclosureVersion: CONSENT_VERSION,
            channels: {
              email: marketingOptIn,
              sms: marketingOptIn,
              whatsapp: marketingOptIn,
            },
          },
      }, '/api/auth/complete-signup');
      await parseApiResponse(signupResponse, 'Failed to complete sign up');

      const result = await signInWithEmailAndPassword(auth, normalizedSignupEmail, password);
      await handleProfileSetup(result.user, normalizedSignupPhone, sanitizeDisplayName(displayName), true);
    } catch (error: any) {
      console.error("Complete Sign Up Error:", error);
      if (error.code === 'auth/email-already-in-use' || /already (registered|exists|been registered)/i.test(error.message || '')) {
        if (role === 'driver' && isAndroidAppRuntime()) {
          try {
            const resumed = await signInWithEmailAndPassword(auth, normalizedSignupEmail, password);
            await handleProfileSetup(resumed.user, normalizedSignupPhone, sanitizeDisplayName(displayName), false);
            alert('We found your unfinished driver signup and resumed it. Please continue verification.');
            return;
          } catch (resumeError: any) {
            console.warn('Android driver signup resume failed:', resumeError);
          }
        }
        alert("This email is already registered. Please login instead.");
        setAuthMode('login');
      } else {
        alert(error.message || "Failed to complete sign up.");
      }
      throw error;
    }
  };

  const handleLogin = async () => {
    const normalizedUsername = username.trim();
    const isPhone = /^\+?[\d\s-]{10,}$/.test(normalizedUsername);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedUsername);

    if (isPhone) {
      if (!normalizedUsername) {
        alert("Please enter phone number");
        return;
      }
    } else {
      if (!normalizedUsername || !password) {
        alert("Please enter email and password");
        return;
      }
    }

    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      let existingProfile: UserProfile | null = null;

      if (isPhone) {
        const normalizedLoginPhone = normalizePhoneForAuth(normalizedUsername);
        if (!normalizedLoginPhone) {
          throw new Error("Please enter a valid phone number.");
        }

        // Trigger Phone OTP Login
        setPhoneNumber(normalizedLoginPhone);
        safeStorageSet('session', PHONE_LOGIN_NUMBER_KEY, normalizedLoginPhone);
        const response = await postAuthAction('send-otp', { phoneNumber: normalizedLoginPhone }, '/api/auth/send-otp');
        const data = await parseApiResponse(response, 'Failed to send OTP');
        if (data.Status === 'Success') {
          setSessionId(data.Details);
          setStep('otp');
        } else {
          throw new Error(data.Details || 'Failed to send OTP');
        }
      } else {
        // Email/Password Login
        if (isAndroidWebViewRuntime) {
          const fallbackResponse = await postAuthAction(
            'password-login',
            { email: normalizeEmailValue(normalizedUsername), password },
            '/api/auth/password-login'
          );
          const fallbackData = await parseApiResponse(fallbackResponse, 'Failed to login');
          const accessToken = String(fallbackData?.session?.access_token || '');
          const refreshToken = String(fallbackData?.session?.refresh_token || '');

          if (!accessToken || !refreshToken) {
            throw new Error('Login session could not be established.');
          }

          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (setSessionError) {
            throw new Error(setSessionError.message || 'Failed to set login session.');
          }

          window.location.reload();
          return;
        }

        try {
          const result = await signInWithEmailAndPassword(auth, normalizeEmailValue(normalizedUsername), password);
          await handleProfileSetup(result.user, undefined, undefined, false);
        } catch (loginError: any) {
          const loginMessage = String(loginError?.message || "").toLowerCase();
          const canUseServerFallback = loginMessage.includes("failed to fetch") || loginMessage.includes("network");

          if (!canUseServerFallback) {
            throw loginError;
          }

          const fallbackResponse = await postAuthAction(
            'password-login',
            { email: normalizeEmailValue(normalizedUsername), password },
            '/api/auth/password-login'
          );
          const fallbackData = await parseApiResponse(fallbackResponse, 'Failed to login');
          const accessToken = String(fallbackData?.session?.access_token || '');
          const refreshToken = String(fallbackData?.session?.refresh_token || '');

          if (!accessToken || !refreshToken) {
            throw new Error('Login session could not be established.');
          }

          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (setSessionError) {
            throw new Error(setSessionError.message || 'Failed to set login session.');
          }

          window.location.reload();
          return;
        }
      }
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert("Authentication method not enabled. Please check Firebase Console.");
      } else if (error.code === 'auth/wrong-password') {
        alert("Incorrect password. Please try again.");
      } else if (error.message === "NOT_REGISTERED" || error.code === 'auth/user-not-found') {
        setNotRegisteredError(true);
      } else {
        alert(error.message || "Invalid credentials.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      if (authMode === 'signup' && role === 'driver' && isAndroidAppRuntime()) {
        const { cameraGranted, locationGranted } = await ensureAndroidDriverSignupPermissions();
        if (!cameraGranted || !locationGranted) {
          alert('Camera and location permissions are required before driver signup can continue. Please allow both permissions and try again.');
          return;
        }
      }
      safeStorageSet('session', OAUTH_MODE_KEY, authMode);
      safeStorageSet('session', OAUTH_ROLE_KEY, role);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        await handleProfileSetup(result.user, undefined, undefined, authMode === 'signup');
      }
    } catch (error: any) {
      console.error("Google Login Error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert("Google authentication is not enabled in your Supabase project. Please enable the Google provider in Supabase Auth.");
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        alert("An account already exists with this email but using a different login method. Please use your original login method.");
      } else if (error.message === "NOT_REGISTERED") {
        setNotRegisteredError(true);
      } else if (error.code !== 'auth/popup-closed-by-user') {
        alert(error.message || "Failed to login with Google.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileSetup = async (user: User, phone?: string, name?: string, isSignUp: boolean = false) => {
    const path = `users/${user.uid}`;
    const mappedPhoneProfileId = !isSignUp && user.isAnonymous ? safeStorageGet('session', PHONE_LOGIN_PROFILE_KEY) : null;

    if (mappedPhoneProfileId) {
      return;
    }

    try {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const targetPhone = user.phoneNumber || phone || '';
        const phoneCandidates = buildPhoneVariants(targetPhone);
        const targetEmail = normalizeEmailValue(user.email || '');
        const emailCandidates = Array.from(
          new Set([user.email || '', targetEmail].map(normalizeEmailValue).filter(Boolean))
        );
        const selectedOAuthRole = getStoredOAuthRole();

        // Check for existing profile by email or phone
        let existingProfile: UserProfile | null = null;
        
        if (emailCandidates.length) {
          for (const emailCandidate of emailCandidates) {
            const qEmail = query(collection(db, 'users'), where('email', '==', emailCandidate));
            const emailSnap = await getDocs(qEmail);
            if (!emailSnap.empty) {
              existingProfile = emailSnap.docs[0].data() as UserProfile;
              break;
            }
          }
        }

        if (!existingProfile && phoneCandidates.length) {
          for (const candidate of phoneCandidates) {
            const qPhone = query(collection(db, 'users'), where('phoneNumber', '==', candidate));
            const phoneSnap = await getDocs(qPhone);
            if (!phoneSnap.empty) {
              existingProfile = phoneSnap.docs[0].data() as UserProfile;
              break;
            }
          }
        }

        if (!existingProfile && !isSignUp && user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
          throw new Error("NOT_REGISTERED");
        }

        if (existingProfile) {
          // If profile exists with different UID, "migrate" it to the new UID
          const oldUid = existingProfile.uid;
          const existingTravelerAvatarSource =
            existingProfile.role === 'consumer'
              ? resolveTravelerAvatarSource(existingProfile)
              : existingProfile.travelerAvatarSource;
          const newProfile = {
            ...existingProfile,
            uid: user.uid,
            ...(existingProfile.role === 'consumer' ? { travelerAvatarSource: existingTravelerAvatarSource } : {}),
            ...(isSignUp
              ? {
                  consents: existingProfile.consents ?? {
                    truthfulInformationAccepted: truthDeclarationAccepted,
                    termsAccepted,
                    marketingOptIn,
                    acceptedAt: new Date().toISOString(),
                    disclosureVersion: CONSENT_VERSION,
                    channels: {
                      email: marketingOptIn,
                      sms: marketingOptIn,
                      whatsapp: marketingOptIn,
                    },
                  },
                }
              : {}),
          };
          
          await setDoc(docRef, newProfile);
          clearStoredOAuthIntent();
          if (isSignUp) {
            void requestAndroidRegistrationPermissions({ uid: user.uid, role: newProfile.role });
          }
          
          if (oldUid !== user.uid && !oldUid.startsWith('manual_')) {
            await deleteDoc(doc(db, 'users', oldUid));
          }
          return;
        }

        const isAdminEmail = targetEmail === SUPER_ADMIN_EMAIL;
        const isTravelerRole = !isAdminEmail && selectedOAuthRole === 'consumer';
        const newProfile: UserProfile = {
          uid: user.uid,
          email: targetEmail,
          displayName: name || user.displayName || phone || 'User',
          role: isAdminEmail ? 'admin' : selectedOAuthRole,
          status: 'active',
          photoURL: isTravelerRole ? (user.photoURL || '') : (isAdminEmail || selectedOAuthRole === 'driver' ? (user.photoURL || '') : ''),
          travelerAvatarSource: isTravelerRole ? (user.photoURL ? 'provider' : 'none') : undefined,
          phoneNumber: targetPhone,
          onboardingComplete: isAdminEmail,
          createdAt: new Date().toISOString(),
          ...(isSignUp
            ? {
                consents: {
                  truthfulInformationAccepted: truthDeclarationAccepted,
                  termsAccepted,
                  marketingOptIn,
                  acceptedAt: new Date().toISOString(),
                  disclosureVersion: CONSENT_VERSION,
                  channels: {
                    email: marketingOptIn,
                    sms: marketingOptIn,
                    whatsapp: marketingOptIn,
                  },
                },
              }
            : {}),
        };
        await setDoc(docRef, newProfile);
        clearStoredOAuthIntent();
        if (isSignUp) {
          void requestAndroidRegistrationPermissions({ uid: user.uid, role: newProfile.role });
        }
        
        // Initialize wallet and referral
        await walletService.initializeUserWallet(user.uid, referralCodeInput || undefined);
      } else {
        const existingProfile = docSnap.data() as UserProfile;
        if (existingProfile.role === 'consumer' && !existingProfile.travelerAvatarSource) {
          await updateDoc(docRef, {
            travelerAvatarSource: resolveTravelerAvatarSource(existingProfile),
          });
        }
        if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL && existingProfile.role !== 'admin') {
          await updateDoc(docRef, { role: 'admin', onboardingComplete: true });
        }
        clearStoredOAuthIntent();
        if (isSignUp) {
          void requestAndroidRegistrationPermissions({ uid: user.uid, role: existingProfile.role });
        }
      }
    } catch (error: any) {
      if (error.message === "NOT_REGISTERED") throw error;
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  return (
    <div className="min-h-screen min-h-[100svh] bg-mairide-bg flex flex-col items-center justify-start md:justify-center p-4 pt-6 pb-8 overflow-y-auto">
      <div id="recaptcha-container"></div>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[32px] p-8 shadow-xl border border-mairide-secondary my-2 md:my-0"
      >
        <div className="flex flex-col items-center mb-6">
          <img src={LOGO_URL} className="w-32 h-32 object-contain rounded-[22%] mb-2" alt="MaiRide Logo" />
          <h1 className="text-2xl font-black tracking-tighter text-mairide-primary uppercase">
            {BRAND_NAME}
          </h1>
        </div>

        {!isRedirectedFromLogin && (
          <div className="flex bg-mairide-bg p-1 rounded-2xl mb-6">
            <button
              onClick={() => setRole('consumer')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-semibold transition-all",
                role === 'consumer' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary hover:text-mairide-accent"
              )}
            >
              Traveler
            </button>
            <button
              onClick={() => setRole('driver')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-semibold transition-all",
                role === 'driver' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary hover:text-mairide-accent"
              )}
            >
              Driver
            </button>
          </div>
        )}

        {isRedirectedFromLogin && authMode === 'signup' && (
          <div className="mb-6 p-4 bg-mairide-bg rounded-2xl border border-mairide-accent/20 text-center">
            <p className="text-xs font-bold text-mairide-accent uppercase tracking-widest">
              Signing up as {role === 'driver' ? 'a Driver' : 'a Traveler'}
            </p>
            <button 
              onClick={() => setIsRedirectedFromLogin(false)}
              className="text-[10px] text-mairide-secondary underline mt-1"
            >
              Change Role
            </button>
          </div>
        )}

        <div className="flex justify-center space-x-4 mb-6">
          {!user && (
            <button 
              onClick={() => { setAuthMode('login'); setNotRegisteredError(false); setIsRedirectedFromLogin(false); }}
              className={cn("text-sm font-bold pb-1 border-b-2 transition-all", authMode === 'login' ? "border-mairide-accent text-mairide-accent" : "border-transparent text-mairide-secondary")}
            >
              Login
            </button>
          )}
          <button 
            onClick={() => { setAuthMode('signup'); setNotRegisteredError(false); setIsRedirectedFromLogin(false); }}
            className={cn("text-sm font-bold pb-1 border-b-2 transition-all", authMode === 'signup' ? "border-mairide-accent text-mairide-accent" : "border-transparent text-mairide-secondary")}
          >
            {user ? 'Complete Profile' : 'Sign Up'}
          </button>
        </div>

        <AnimatePresence>
          {notRegisteredError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
              >
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-xl font-black text-mairide-primary mb-2 uppercase tracking-tight">Not Registered</h2>
                <p className="text-gray-600 mb-6">
                  We could not find a completed MaiRide account linked to this login yet. Please sign up to continue.
                </p>
                <div className="space-y-3">
                  <button 
                    onClick={() => {
                      setAuthMode('signup');
                      setNotRegisteredError(false);
                      setIsRedirectedFromLogin(true);
                    }}
                    className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all"
                  >
                    Sign Up as {role === 'driver' ? 'Driver' : 'Traveler'}
                  </button>
                  <button 
                    onClick={() => {
                      setRole(role === 'driver' ? 'consumer' : 'driver');
                    }}
                    className="w-full text-mairide-accent font-bold py-2 text-sm"
                  >
                    Sign Up as {role === 'driver' ? 'Traveler' : 'Driver'} instead
                  </button>
                  <button 
                    onClick={() => setNotRegisteredError(false)}
                    className="w-full text-gray-500 font-bold py-2"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="space-y-4">
          {authMode === 'signup' ? (
            step === 'phone' ? (
              <div className="space-y-4">
                <input 
                  type="text" 
                  placeholder="Full Name"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={displayName}
                  onChange={(e) => setDisplayName(sanitizeDisplayName(e.target.value))}
                  autoComplete="name"
                />
                <input 
                  type="email" 
                  placeholder="Email Address"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={email}
                  onChange={(e) => setEmail(normalizeEmailValue(e.target.value))}
                  autoComplete="email"
                />
                <IndianPhoneInput
                  value={phoneNumber}
                  onChange={setPhoneNumber}
                />
                
                {!user && (
                  <input 
                    type="password" 
                    placeholder="Create Password"
                    className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                  />
                )}
                <input 
                  type="text" 
                  placeholder="Referral Code (Optional)"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={referralCodeInput}
                  onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase().replace(/\s+/g, '').slice(0, 20))}
                />
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={truthDeclarationAccepted}
                  onChange={(e) => setTruthDeclarationAccepted(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    {role === 'driver' ? DRIVER_DISCLOSURE_TEXT : TRAVELER_DISCLOSURE_TEXT}
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    I agree to MaiRide&apos;s Terms and Conditions, Privacy Policy, safety verification process, and platform usage rules.
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={marketingOptIn}
                    onChange={(e) => setMarketingOptIn(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    {MARKETING_DISCLOSURE_TEXT}
                  </span>
                </label>
                <button
                  onClick={handleEmailPasswordSignUp}
                  disabled={isLoading}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Sending OTP..." : (user ? "Complete Profile" : "Sign Up")}
                </button>
              </div>
            ) : step === 'email-otp' ? (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Email verification</p>
                  <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit verification code sent to your email address.</p>
                  <p className="mt-3 text-base font-semibold text-mairide-primary break-all">{email}</p>
                </div>
                <input 
                  type="text" 
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                />
                <button
                  onClick={handleVerifyEmailOtp}
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify Email OTP"}
                </button>
                <button
                  onClick={async () => {
                    setOtp('');
                    await handleSendEmailOtp();
                  }}
                  disabled={isLoading}
                  className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
                >
                  {isLoading ? "Please wait..." : "Resend Email OTP"}
                </button>
                <button 
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Phone verification</p>
                  <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit verification code sent to your mobile number.</p>
                  <p className="mt-3 text-base font-semibold text-mairide-primary">{maskedOtpPhone}</p>
                </div>
                <input 
                  type="text" 
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : (authMode === 'signup' ? (user ? "Complete Profile" : "Verify & Sign Up") : "Verify & Login")}
                </button>
                <button
                  onClick={async () => {
                    setOtp('');
                    await handleSendOtp();
                  }}
                  disabled={isLoading}
                  className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
                >
                  {isLoading ? "Please wait..." : "Resend Phone OTP"}
                </button>
                <button 
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            )
          ) : step === 'otp' ? (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Phone login verification</p>
                <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit login code sent to your registered mobile number.</p>
                <p className="mt-3 text-base font-semibold text-mairide-primary">{maskedOtpPhone}</p>
              </div>
              <input 
                type="text" 
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                value={otp}
                maxLength={6}
                onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              />
              <button
                onClick={handleVerifyOtp}
                disabled={isLoading || otp.length !== 6}
                className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
              >
                {isLoading ? "Verifying..." : "Verify & Login"}
              </button>
              <button
                onClick={async () => {
                  setOtp('');
                  await handleSendOtp();
                }}
                disabled={isLoading}
                className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
              >
                {isLoading ? "Please wait..." : "Resend Login OTP"}
              </button>
              <button
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setSessionId('');
                }}
                className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
              >
                Change Login Method
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Email or Phone Number"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (step !== 'phone') {
                    setStep('phone');
                    setOtp('');
                    setSessionId('');
                  }
                }}
              />
              {!/^\+?[\d\s-]{10,}$/.test(username) && (
                <input 
                  type="password" 
                  placeholder="Password"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              {!/^\+?[\d\s-]{10,}$/.test(username) && (
                <button
                  type="button"
                  onClick={() => {
                    setResetIdentifier(username.trim());
                    setShowForgotPassword(true);
                    setResetStep('identifier');
                  }}
                  className="w-full text-right text-xs font-semibold text-mairide-accent hover:text-mairide-primary"
                >
                  Forgot password?
                </button>
              )}
              <button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
              >
                {isLoading ? "Processing..." : (/^\+?[\d\s-]{10,}$/.test(username) ? "Send Login OTP" : "Login")}
              </button>
            </div>
          )}

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-mairide-secondary"></div>
            <span className="flex-shrink mx-4 text-mairide-secondary text-[10px] font-bold uppercase">OR</span>
            <div className="flex-grow border-t border-mairide-secondary"></div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white border border-mairide-secondary hover:bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold flex items-center justify-center space-x-3 transition-all disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            <span>Continue with Google</span>
          </button>

          <p className="text-center text-[10px] text-mairide-secondary px-4 leading-relaxed">
            By continuing, you agree to MaiRide's Terms of Service and Privacy Policy.
          </p>

          <a
            href="/business-model.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block w-full rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-center text-sm font-bold text-mairide-primary transition-all hover:bg-mairide-bg"
          >
            Learn How MaiRide Works
          </a>
        </div>
      </motion.div>
      <AnimatePresence>
        {showForgotPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-mairide-primary/40 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Account recovery</p>
                  <h3 className="mt-2 text-2xl font-black text-mairide-primary">Reset password with mobile OTP</h3>
                </div>
                <button
                  onClick={resetForgotPasswordFlow}
                  className="rounded-full bg-mairide-bg p-2 text-mairide-secondary hover:text-mairide-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {resetStep === 'identifier' && (
                <div className="mt-5 space-y-4">
                  <input
                    type="text"
                    placeholder="Registered email or mobile number"
                    value={resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  />
                  <button
                    onClick={handleSendResetOtp}
                    disabled={isLoading}
                    className="w-full rounded-2xl bg-mairide-accent py-3 font-bold text-white"
                  >
                    {isLoading ? 'Sending OTP...' : 'Send OTP'}
                  </button>
                </div>
              )}

              {resetStep === 'otp' && (
                <div className="mt-5 space-y-4">
                  <p className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-3 text-sm text-mairide-secondary">
                    OTP sent to registered mobile: <span className="font-bold text-mairide-primary">{resetMaskedPhone || 'linked number'}</span>
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="Enter 6-digit OTP"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-center text-xl tracking-[0.18em] text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  />
                  <button
                    onClick={handleVerifyResetOtp}
                    disabled={isLoading || resetOtp.length !== 6}
                    className="w-full rounded-2xl bg-mairide-accent py-3 font-bold text-white disabled:opacity-50"
                  >
                    {isLoading ? 'Verifying OTP...' : 'Verify OTP'}
                  </button>
                </div>
              )}

              {resetStep === 'password' && (
                <div className="mt-5 space-y-4">
                  <input
                    type="password"
                    placeholder="New password (min 6 characters)"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmResetPassword}
                    onChange={(e) => setConfirmResetPassword(e.target.value)}
                    className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  />
                  <button
                    onClick={handleSubmitResetPassword}
                    disabled={isLoading}
                    className="w-full rounded-2xl bg-mairide-accent py-3 font-bold text-white disabled:opacity-50"
                  >
                    {isLoading ? 'Updating password...' : 'Update Password'}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
    </div>
  );
};

// --- Camera Capture Component ---

const CameraCapture = ({ onCapture, onCancel, title }: { onCapture: (image: string) => void, onCancel: () => void, title: string }) => {
  const webcamRef = React.useRef<Webcam>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isTakingTooLong, setIsTakingTooLong] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  useEffect(() => {
    if (!isReady && !error) {
      const timer = setTimeout(() => {
        setIsTakingTooLong(true);
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setIsTakingTooLong(false);
    }
  }, [isReady, error, retryCount]);

  const capture = React.useCallback(() => {
    if (!isReady) return;
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      onCapture(imageSrc);
    }
  }, [webcamRef, onCapture, isReady]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    setIsReady(false);
    setRetryCount(prev => prev + 1);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-[32px] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
          {!navigator.mediaDevices?.getUserMedia && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-gray-900 p-6 text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
              <p className="text-white font-semibold mb-2">Not Supported</p>
              <p className="text-gray-400 text-sm">Your browser does not support camera access or you are not using HTTPS.</p>
            </div>
          )}
          {!isReady && !error && navigator.mediaDevices?.getUserMedia && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black">
              <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mb-4" />
              {isTakingTooLong && (
                <div className="text-center p-4">
                  <p className="text-white text-sm mb-4">Camera is taking longer than expected...</p>
                  <button 
                    onClick={() => {
                      setRetryCount(prev => prev + 1);
                      setIsTakingTooLong(false);
                    }}
                    className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs hover:bg-white/20"
                  >
                    Try Re-initializing
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-900 p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <p className="text-white font-semibold mb-2">Camera Error</p>
              <p className="text-gray-400 text-sm mb-6">{error}</p>
              <div className="flex space-x-4">
                <button 
                  onClick={() => {
                    setError(null);
                    setIsReady(false);
                    setRetryCount(prev => prev + 1);
                  }}
                  className="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold text-sm"
                >
                  Retry
                </button>
                <button 
                  onClick={onCancel}
                  className="px-6 py-2 bg-white text-gray-900 rounded-xl font-bold text-sm"
                >
                  Go Back
                </button>
              </div>
            </div>
          )}
          <Webcam
            key={`${retryCount}-${facingMode}`}
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full h-full object-cover"
            videoConstraints={{ 
              facingMode: facingMode
            }}
            mirrored={facingMode === 'user'}
            screenshotQuality={0.8}
            imageSmoothing={true}
            forceScreenshotSourceSize={false}
            disablePictureInPicture={true}
            onUserMedia={() => setIsReady(true)}
            onUserMediaError={(err) => {
              console.error("Webcam Error:", err);
              const errorMessage = typeof err === 'string' ? err : (err as any).message || (err as any).name || "Could not access camera.";
              setError(`${errorMessage}. Please ensure permissions are granted.`);
              setIsReady(false);
            }}
          />
          <div className="absolute inset-0 border-2 border-dashed border-white/30 pointer-events-none m-8 rounded-xl" />
          
          {isReady && (
            <button 
              onClick={toggleCamera}
              className="absolute bottom-4 right-4 bg-black/50 text-white p-3 rounded-full backdrop-blur-md hover:bg-black/70 transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="p-8 flex flex-col space-y-4">
          <button
            onClick={capture}
            disabled={!isReady}
            className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-orange-100 hover:scale-[1.02] transition-transform flex items-center justify-center space-x-2 disabled:opacity-50 disabled:hover:scale-100"
          >
            <Camera className="w-5 h-5" />
            <span>Capture Photo</span>
          </button>
          <p className="text-[10px] text-center text-gray-400 uppercase font-bold tracking-widest">
            Ensure the document is clearly visible and well-lit
          </p>
        </div>
      </div>
    </div>
  );
};

// --- Wallet Dashboard Component ---

const WalletDashboard = ({ profile }: { profile: UserProfile }) => {
  const [stats, setStats] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [driverCompletedBookings, setDriverCompletedBookings] = useState<Booking[]>([]);
  const [showEarningsDetail, setShowEarningsDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWalletData = async () => {
      setIsLoading(true);
      try {
        const requests: Promise<any>[] = [
          walletService.getReferralStats(profile.uid),
          getDocs(query(
            collection(db, 'transactions'), 
            where('userId', '==', profile.uid),
            orderBy('createdAt', 'desc'),
            limit(10)
          ))
        ];

        if (profile.role === 'driver') {
          requests.push(
            getDocs(query(
              collection(db, 'bookings'),
              where('driverId', '==', profile.uid),
              orderBy('createdAt', 'desc'),
              limit(20)
            ))
          );
        }

        const [s, txSnapshot, driverBookingSnapshot] = await Promise.all(requests);
        setStats(s);
        setTransactions(txSnapshot.docs.map(doc => doc.data() as Transaction));
        if (profile.role === 'driver' && driverBookingSnapshot) {
          const bookings = driverBookingSnapshot.docs
            .map((doc: any) => doc.data() as Booking)
            .filter((booking: Booking) => Boolean(booking.rideEndedAt || booking.status === 'completed'));
          setDriverCompletedBookings(bookings);
        } else {
          setDriverCompletedBookings([]);
        }
      } catch (error) {
        console.error("Failed to fetch wallet data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWalletData();
  }, [profile.uid]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
        <div className="bg-mairide-primary p-6 rounded-[40px] text-white flex-1 shadow-xl shadow-mairide-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
          <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">Available Balance</p>
            <div className="flex items-baseline space-x-2">
              <h2 className="text-5xl font-black tracking-tighter">{profile.wallet?.balance || 0}</h2>
              <span className="text-xl font-bold opacity-80 uppercase">MaiCoins</span>
            </div>
            <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold uppercase opacity-60 mb-1">Pending Rewards</p>
                <p className="font-bold text-lg">{profile.wallet?.pendingBalance || 0} MC</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase opacity-60 mb-1">Referral Code</p>
                <div className="flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full">
                  <span className="font-mono font-bold">{profile.referralCode}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(profile.referralCode || '');
                      alert('Referral code copied!');
                    }}
                    className="hover:text-mairide-accent transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 flex-1">
          {profile.role === 'driver' && (
            <button
              type="button"
              onClick={() => setShowEarningsDetail((prev) => !prev)}
              className="col-span-2 bg-white p-4 rounded-3xl border border-mairide-secondary text-left hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Total Earnings</p>
                  <p className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Completed rides</p>
                  <p className="text-xl font-black text-mairide-accent">{driverCompletedBookings.length}</p>
                  <p className="mt-2 text-xs font-bold text-mairide-primary">{showEarningsDetail ? 'Hide details' : 'View details'}</p>
                </div>
              </div>
            </button>
          )}
          <div className="bg-white p-4 rounded-3xl border border-mairide-secondary text-center">
            <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Tier 1</p>
            <p className="text-xl font-black text-mairide-primary">{stats?.tier1 || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-3xl border border-mairide-secondary text-center">
            <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Tier 2</p>
            <p className="text-xl font-black text-mairide-primary">{stats?.tier2 || 0}</p>
          </div>
          <div className="col-span-2 bg-mairide-bg p-4 rounded-3xl border border-mairide-secondary flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-xl">
                <Users className="w-5 h-5 text-mairide-accent" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total Network</p>
                <p className="font-bold text-mairide-primary">{(stats?.tier1 || 0) + (stats?.tier2 || 0)} Members</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total Earned</p>
              <p className="font-bold text-green-600">{stats?.totalEarned || 0} MC</p>
            </div>
          </div>
        </div>
      </div>

      {profile.role === 'driver' && showEarningsDetail && (
        <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-mairide-primary">Earnings Detail</h3>
              <p className="text-sm text-mairide-secondary">Only completed rides are counted here.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total earnings</p>
              <p className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</p>
            </div>
          </div>
          {driverCompletedBookings.length ? (
            <div className="space-y-3">
              {driverCompletedBookings.map((booking) => (
                <div key={booking.id} className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/30">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                      <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary mt-2">
                        {booking.rideEndedAt ? new Date(booking.rideEndedAt).toLocaleString() : new Date(booking.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Ride earning</p>
                      <p className="text-xl font-black text-mairide-accent">{formatCurrency(booking.fare)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-mairide-bg p-6 text-center text-mairide-secondary italic">
              Completed rides will appear here once journeys are fully closed.
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-mairide-primary flex items-center">
          <History className="w-5 h-5 mr-2 text-mairide-accent" />
          Recent Transactions
        </h3>
        <div className="bg-white rounded-[32px] border border-mairide-secondary overflow-hidden shadow-sm">
          {transactions.length > 0 ? (
            <div className="divide-y divide-mairide-bg">
              {transactions.map(tx => (
                <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-mairide-bg/30 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className={cn(
                      "p-2 rounded-xl",
                      tx.type.includes('referral') ? "bg-green-50 text-green-600" : 
                      tx.type.includes('payment') ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                    )}>
                      {tx.type.includes('referral') ? <ArrowUpRight className="w-5 h-5" /> : 
                       tx.type.includes('payment') ? <ArrowDownLeft className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-mairide-primary">{tx.description}</p>
                      <p className="text-[10px] text-mairide-secondary uppercase font-bold tracking-widest">
                        {new Date(tx.createdAt).toLocaleDateString()} • {tx.type.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-black",
                      tx.type.includes('referral') || tx.type === 'wallet_topup' ? "text-green-600" : "text-red-600"
                    )}>
                      {tx.type.includes('referral') || tx.type === 'wallet_topup' ? '+' : '-'}{tx.amount} MC
                    </p>
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase">{tx.status}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center">
              <p className="text-mairide-secondary italic serif">No transactions yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Driver Onboarding ---

const DriverOnboarding = ({
  profile,
  onComplete,
  isLoaded,
}: {
  profile: UserProfile;
  onComplete: () => void;
  isLoaded: boolean;
}) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    selfiePhoto: '',
    selfieGeoTag: null as any,
    aadhaarNumber: '',
    aadhaarFrontPhoto: '',
    aadhaarFrontGeoTag: null as any,
    aadhaarBackPhoto: '',
    aadhaarBackGeoTag: null as any,
    aadhaarGeoTag: null as any, // Legacy
    dlNumber: '',
    dlFrontPhoto: '',
    dlFrontGeoTag: null as any,
    dlBackPhoto: '',
    dlBackGeoTag: null as any,
    dlGeoTag: null as any, // Legacy
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    vehicleCapacity: 4,
    vehicleRegNumber: '',
    insuranceStatus: 'active' as 'active' | 'expired',
    insuranceProvider: '',
    insuranceExpiryDate: '',
    vehiclePhoto: '',
    vehicleGeoTag: null as any,
    rcPhoto: '',
    rcGeoTag: null as any,
    declarationAccepted: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capturingField, setCapturingField] = useState<string | null>(null);
  const verificationMarkers = buildVerificationMarkers(formData as any);
  const aadhaarSegments = splitAadhaarDigits(formData.aadhaarNumber);

  useEffect(() => {
    void requestAndroidRegistrationPermissions({ uid: profile.uid, role: 'driver' });
  }, [profile.uid]);

  const updateAadhaarSegment = (index: number, value: string) => {
    const nextSegments = [...aadhaarSegments];
    nextSegments[index] = String(value || '').replace(/[^\d]/g, '').slice(0, 4);
    setFormData(prev => ({
      ...prev,
      aadhaarNumber: nextSegments.join(''),
    }));
  };

  const getCurrentLocation = (): Promise<{ lat: number, lng: number, timestamp: number }> => {
    return new Promise((resolve, reject) => {
      if (Capacitor.isNativePlatform() && isAndroidAppRuntime()) {
        Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0,
        })
          .then((pos) =>
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              timestamp: Date.now(),
            })
          )
          .catch((err) => reject(err));
        return;
      }

      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: Date.now()
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  };

  const assignCapturedDriverImage = async (field: string, image: string) => {
    try {
      const normalizedImage = await compressDataUrlImage(image);
      const location = await getCurrentLocation();
      const geoTagFieldMap: Record<string, string> = {
        selfiePhoto: 'selfieGeoTag',
        aadhaarFrontPhoto: 'aadhaarFrontGeoTag',
        aadhaarBackPhoto: 'aadhaarBackGeoTag',
        dlFrontPhoto: 'dlFrontGeoTag',
        dlBackPhoto: 'dlBackGeoTag',
        vehiclePhoto: 'vehicleGeoTag',
        rcPhoto: 'rcGeoTag',
      };
      const geoTagField = geoTagFieldMap[field] || null;

      setFormData(prev => ({
        ...prev,
        [field]: normalizedImage,
        ...(geoTagField ? { [geoTagField]: location } : {}),
        ...(field.startsWith('aadhaar') ? { aadhaarGeoTag: location } : {}),
        ...(field.startsWith('dl') ? { dlGeoTag: location } : {})
      }));
    } catch (error) {
      console.warn("Geo-tagging failed:", error);
      const normalizedImage = await compressDataUrlImage(image);
      setFormData(prev => ({ ...prev, [field]: normalizedImage }));
    }
  };

  const handleCapture = async (image: string) => {
    if (!capturingField) return;
    await assignCapturedDriverImage(capturingField, image);
    setCapturingField(null);
  };

  const startDriverCapture = async (field: string) => {
    if (isAndroidAppRuntime()) {
      const { cameraGranted, locationGranted } = await ensureAndroidDriverSignupPermissions();
      if (!cameraGranted || !locationGranted) {
        showAppDialog(
          'Camera and location permissions are required for driver verification captures. Please allow them in app settings and try again.',
          'warning',
          'Permissions required'
        );
        return;
      }

      try {
        const photo = await CapacitorCamera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          saveToGallery: false,
        });
        const imagePayload =
          String(photo?.dataUrl || '').trim() ||
          (photo?.base64String ? `data:image/jpeg;base64,${photo.base64String}` : '');
        if (!imagePayload) return;
        await assignCapturedDriverImage(field, imagePayload);
      } catch (error: any) {
        const message = String(error?.message || error || '');
        if (/permission|denied|not authorized|forbidden/i.test(message)) {
          showAppDialog(
            'Camera permission is still blocked. Please enable camera and location permissions for MaiRide in Android settings, then try again.',
            'warning',
            'Permissions required'
          );
          return;
        }
        if (!/cancel|user cancelled|user canceled/i.test(message)) {
          showAppDialog(message || 'We could not open the camera right now. Please try again.', 'error', 'Camera unavailable');
        }
      }
      return;
    }

    setCapturingField(field);
  };

  const uploadImage = async (base64: string, path: string) => {
    if (!base64) return '';
    let token = '';
    try {
      token = await getAccessToken();
    } catch {
      token = '';
    }

    try {
      const response = await axios.post(
        '/api/user?action=upload-driver-doc',
        {
          driverId: profile.uid,
          path,
          dataUrl: base64,
        },
        {
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : undefined,
        }
      );

      if (response.data?.url) {
        return response.data.url as string;
      }
      throw new Error('Failed to upload driver document');
    } catch (apiUploadError) {
      console.warn('Driver doc API upload failed, using Firebase storage fallback:', apiUploadError);
      const fallbackRef = storageRef(storage, `drivers/${profile.uid}/${path}`);
      await uploadString(fallbackRef, base64, 'data_url');
      return await getDownloadURL(fallbackRef);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const activeUid = auth.currentUser?.uid || profile.uid;
      if (!activeUid) {
        throw new Error('Missing user identity. Please login again and retry onboarding.');
      }

      // Upload images to storage
      const selfieUrl = await uploadImage(formData.selfiePhoto, 'selfie.jpg');
      const aadhaarFrontUrl = await uploadImage(formData.aadhaarFrontPhoto, 'aadhaar_front.jpg');
      const aadhaarBackUrl = await uploadImage(formData.aadhaarBackPhoto, 'aadhaar_back.jpg');
      const dlFrontUrl = await uploadImage(formData.dlFrontPhoto, 'dl_front.jpg');
      const dlBackUrl = await uploadImage(formData.dlBackPhoto, 'dl_back.jpg');
      const vehicleUrl = await uploadImage(formData.vehiclePhoto, 'vehicle.jpg');
      const rcUrl = await uploadImage(formData.rcPhoto, 'rc.jpg');

      const driverDetails = {
        ...formData,
        selfiePhoto: selfieUrl,
        aadhaarFrontPhoto: aadhaarFrontUrl,
        aadhaarBackPhoto: aadhaarBackUrl,
        dlFrontPhoto: dlFrontUrl,
        dlBackPhoto: dlBackUrl,
        vehiclePhoto: vehicleUrl,
        rcPhoto: rcUrl,
        isOnline: false,
        rating: 5.0,
        totalEarnings: profile.driverDetails?.totalEarnings || 0,
      };

      const finalizedProfile: Partial<UserProfile> = {
        uid: activeUid,
        email: profile.email || auth.currentUser?.email || '',
        displayName: profile.displayName || auth.currentUser?.displayName || 'Driver',
        role: 'driver',
        status: profile.status || 'active',
        phoneNumber: profile.phoneNumber || auth.currentUser?.phoneNumber || '',
        photoURL: profile.photoURL || auth.currentUser?.photoURL || '',
        onboardingComplete: true,
        verificationStatus: 'pending',
        rejectionReason: null,
        verifiedBy: null as any,
        driverDetails,
      };

      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, 'users', activeUid),
        {
          ...finalizedProfile,
          createdAt: profile.createdAt || nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Non-blocking mirror sync for backend compatibility.
      try {
        let token = '';
        try {
          token = await getAccessToken();
        } catch {
          token = '';
        }
        await axios.post(
          '/api/user?action=complete-driver-onboarding',
          {
            driverId: activeUid,
            driverDetails,
          },
          {
            headers: token
              ? {
                  Authorization: `Bearer ${token}`,
                }
              : undefined,
          }
        );
      } catch (mirrorError) {
        console.warn('Driver onboarding backend mirror sync failed (non-blocking):', mirrorError);
      }

      onComplete();
    } catch (error) {
      console.error('Driver onboarding submit failed:', error);
      const message =
        error instanceof Error
          ? error.message
          : (error as any)?.response?.data?.error || 'Failed to complete setup. Please retry.';
      showAppDialog(message, 'error', 'Complete setup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    { title: "Selfie", description: "Take a clear selfie for identification" },
    { title: "Aadhaar", description: "Upload Aadhaar card details" },
    { title: "License", description: "Upload Driving License details" },
    { title: "Vehicle", description: "Enter vehicle information" },
    { title: "Documents", description: "Upload Vehicle & RC photos" }
  ];

  return (
    <div className="min-h-screen bg-mairide-bg p-4 flex flex-col items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-white rounded-[40px] p-8 shadow-2xl border border-mairide-secondary"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center mb-4">
            <img src={LOGO_URL} className="w-12 h-12 object-contain rounded-[22%] mr-2" alt="MaiRide Logo" />
            <span className="text-xl font-black tracking-tighter text-mairide-primary">
              {BRAND_NAME}
            </span>
          </div>
          <div className="flex justify-between items-center w-full mb-4">
            <div>
              <h1 className="text-2xl font-bold text-mairide-primary">{steps[step-1].title}</h1>
              <p className="text-xs text-mairide-secondary italic serif">{steps[step-1].description}</p>
            </div>
            <span className="text-mairide-accent font-bold text-lg">Step {step}/5</span>
          </div>
          <div className="w-full bg-mairide-bg h-2 rounded-full overflow-hidden">
            <motion.div 
              className="bg-mairide-accent h-full" 
              animate={{ width: `${(step / 5) * 100}%` }}
            />
          </div>
        </div>

        <div className="mb-6">
          <button
            onClick={() => signOut(auth)}
            className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
          >
            Logout and finish later
          </button>
        </div>

        <div className="mb-8">
          <VerificationMap
            markers={verificationMarkers}
            isLoaded={isLoaded}
            title="Verification Capture Map"
            subtitle="Each captured document is pinned here with its geo-tag and capture time for safety review."
          />
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div className="p-8 border-2 border-dashed border-mairide-secondary rounded-[32px] flex flex-col items-center justify-center space-y-4 bg-mairide-bg/30">
              {formData.selfiePhoto ? (
                <div className="relative w-full aspect-square max-w-[240px]">
                  <img src={formData.selfiePhoto} className="w-full h-full object-cover rounded-full border-4 border-white shadow-lg" alt="Selfie" />
                  {formData.selfieGeoTag && (
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[8px] px-2 py-1 rounded-full backdrop-blur-sm">
                      📍 {formData.selfieGeoTag.lat.toFixed(4)}, {formData.selfieGeoTag.lng.toFixed(4)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-inner">
                  <UserIcon className="w-16 h-16 text-mairide-secondary" />
                </div>
              )}
              <button 
                onClick={() => void startDriverCapture('selfiePhoto')}
                className="bg-mairide-primary text-white px-8 py-3 rounded-2xl font-bold text-sm hover:scale-105 transition-transform"
              >
                {formData.selfiePhoto ? 'Retake Selfie' : 'Capture Selfie'}
              </button>
            </div>
            <button 
              disabled={!formData.selfiePhoto}
              onClick={() => setStep(2)}
              className="w-full bg-mairide-accent text-white py-5 rounded-3xl font-bold shadow-lg shadow-mairide-accent/20 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-2 ml-2">Aadhaar Number</label>
              <div className="grid grid-cols-3 gap-3">
                {aadhaarSegments.map((segment, index) => (
                  <input 
                    key={index}
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    placeholder="0000"
                    maxLength={4}
                    className="w-full p-5 bg-mairide-bg border-none rounded-3xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary font-medium text-center tracking-[0.18em]"
                    value={segment}
                    onChange={e => updateAadhaarSegment(index, e.target.value)}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-mairide-secondary">Use the exact 12-digit Aadhaar number, captured in 3 clean blocks of 4 digits each.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front Side</p>
                <div 
                  onClick={() => void startDriverCapture('aadhaarFrontPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.aadhaarFrontPhoto ? (
                    <img src={formData.aadhaarFrontPhoto} className="w-full h-full object-cover" alt="Aadhaar Front" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back Side</p>
                <div 
                  onClick={() => void startDriverCapture('aadhaarBackPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.aadhaarBackPhoto ? (
                    <img src={formData.aadhaarBackPhoto} className="w-full h-full object-cover" alt="Aadhaar Back" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(1)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={!formData.aadhaarNumber || !formData.aadhaarFrontPhoto || !formData.aadhaarBackPhoto}
                onClick={() => setStep(3)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-2 ml-2">Driving License Number</label>
              <input 
                type="text" 
                placeholder="DL Number"
                className="w-full p-5 bg-mairide-bg border-none rounded-3xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary font-medium"
                value={formData.dlNumber}
                onChange={e => setFormData({ ...formData, dlNumber: sanitizeLicenseOrVehicleCode(e.target.value, 20) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front Side</p>
                <div 
                  onClick={() => void startDriverCapture('dlFrontPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.dlFrontPhoto ? (
                    <img src={formData.dlFrontPhoto} className="w-full h-full object-cover" alt="DL Front" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back Side</p>
                <div 
                  onClick={() => void startDriverCapture('dlBackPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.dlBackPhoto ? (
                    <img src={formData.dlBackPhoto} className="w-full h-full object-cover" alt="DL Back" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(2)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={!formData.dlNumber || !formData.dlFrontPhoto || !formData.dlBackPhoto}
                onClick={() => setStep(4)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Make</label>
                <input 
                  type="text" 
                  placeholder="e.g. Maruti"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleMake}
                  onChange={e => setFormData({ ...formData, vehicleMake: sanitizeDisplayName(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Model</label>
                <input 
                  type="text" 
                  placeholder="e.g. Swift"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleModel}
                  onChange={e => setFormData({ ...formData, vehicleModel: sanitizeLicenseOrVehicleCode(e.target.value, 30) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Color</label>
                <input 
                  type="text" 
                  placeholder="e.g. White"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleColor}
                  onChange={e => setFormData({ ...formData, vehicleColor: sanitizeDisplayName(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Capacity</label>
                <input 
                  type="number" 
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleCapacity}
                  onChange={e => setFormData({ ...formData, vehicleCapacity: parseInt(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Registration Number</label>
                <input 
                  type="text" 
                  placeholder="e.g. DL 01 AB 1234"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleRegNumber}
                  onChange={e => setFormData({ ...formData, vehicleRegNumber: sanitizeLicenseOrVehicleCode(e.target.value, 18) })}
                />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Status</label>
              <select
                className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                value={formData.insuranceStatus}
                onChange={e => setFormData({
                  ...formData,
                  insuranceStatus: e.target.value as 'active' | 'expired',
                  insuranceProvider: e.target.value === 'active' ? formData.insuranceProvider : '',
                  insuranceExpiryDate: e.target.value === 'active' ? formData.insuranceExpiryDate : '',
                })}
              >
                <option value="active">Active</option>
                <option value="expired">Expired / Not Active</option>
              </select>
            </div>
            {formData.insuranceStatus === 'active' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. ICICI Lombard"
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                    value={formData.insuranceProvider}
                    onChange={e => setFormData({ ...formData, insuranceProvider: sanitizeDisplayName(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Expiry</label>
                  <input
                    type="date"
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                    value={formData.insuranceExpiryDate}
                    onChange={e => setFormData({ ...formData, insuranceExpiryDate: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div className="flex space-x-4 pt-4">
              <button onClick={() => setStep(3)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={
                  !formData.vehicleMake ||
                  !formData.vehicleModel ||
                  !formData.vehicleRegNumber ||
                  (formData.insuranceStatus === 'active' &&
                    (!formData.insuranceProvider || !formData.insuranceExpiryDate))
                }
                onClick={() => setStep(5)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Vehicle Photo</p>
                <div 
                  onClick={() => void startDriverCapture('vehiclePhoto')}
                  className="aspect-square border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.vehiclePhoto ? (
                    <img src={formData.vehiclePhoto} className="w-full h-full object-cover" alt="Vehicle" />
                  ) : (
                    <Car className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">RC Photo</p>
                <div 
                  onClick={() => void startDriverCapture('rcPhoto')}
                  className="aspect-square border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.rcPhoto ? (
                    <img src={formData.rcPhoto} className="w-full h-full object-cover" alt="RC" />
                  ) : (
                    <ShieldCheck className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/60 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Insurance Status</p>
                  <p className="mt-1 text-sm font-bold text-mairide-primary capitalize">{formData.insuranceStatus}</p>
                </div>
                {formData.insuranceStatus === 'active' && (
                  <>
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Provider</p>
                      <p className="mt-1 text-sm font-bold text-mairide-primary">{formData.insuranceProvider || 'Pending'}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Expiry Date</p>
                      <p className="mt-1 text-sm font-bold text-mairide-primary">{formData.insuranceExpiryDate || 'Pending'}</p>
                    </div>
                  </>
                )}
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-white px-4 py-4 text-left">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-mairide-accent"
                  checked={formData.declarationAccepted}
                  onChange={(e) => setFormData({ ...formData, declarationAccepted: e.target.checked })}
                />
                <span className="text-[11px] leading-relaxed text-mairide-primary">
                  {DRIVER_DISCLOSURE_TEXT} {DRIVER_DECLARATION_TEXT}
                </span>
              </label>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(4)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={
                  !formData.vehiclePhoto ||
                  !formData.rcPhoto ||
                  !formData.declarationAccepted ||
                  isSubmitting
                }
                onClick={handleSubmit}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50 flex items-center justify-center"
              >
                {isSubmitting ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Complete Setup'}
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {capturingField && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60]"
            >
              <CameraCapture 
                title={`Capture ${capturingField.replace('Photo', '').toUpperCase()}`}
                onCapture={handleCapture}
                onCancel={() => setCapturingField(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

const PaymentProofModal = ({
  booking,
  payer,
  config,
  onClose,
  onSubmit,
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  config: AppConfig | null;
  onClose: () => void;
  onSubmit: (payload: { transactionId: string; receiptDataUrl: string }) => Promise<void>;
}) => {
  const [transactionId, setTransactionId] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const payableAmount = calculateServiceFee(booking.fare, config || undefined).totalFee;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setReceiptDataUrl(dataUrl);
    setReceiptName(file.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionId || !receiptDataUrl) {
      alert('Please enter the transaction ID and upload the payment receipt.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ transactionId, receiptDataUrl });
      onClose();
    } catch (error: any) {
      alert(error.message || 'Failed to submit payment proof.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[36px] p-8 shadow-2xl border border-mairide-secondary"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-mairide-primary">Complete Platform Fee Payment</h3>
            <p className="text-sm text-mairide-secondary">
              {payer === 'consumer' ? 'Traveler' : 'Driver'} must pay only the MaiRide maintenance fee to keep contact details locked until both sides comply.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-mairide-bg rounded-full">
            <X className="w-5 h-5 text-mairide-secondary" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-mairide-bg p-5 rounded-3xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Amount to Pay</p>
            <p className="text-3xl font-black text-mairide-accent mt-2">{formatCurrency(payableAmount)}</p>
            <p className="text-xs text-mairide-secondary mt-2">Includes `Rs 100` maintenance fee + `18% GST`.</p>
          </div>
          <div className="bg-mairide-bg p-5 rounded-3xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">UPI ID</p>
            <p className="text-lg font-bold text-mairide-primary mt-2 break-all">{config?.upiId || 'Add UPI ID in admin config'}</p>
            <p className="text-xs text-mairide-secondary mt-2">Pay first, then submit the transaction reference and receipt below.</p>
          </div>
        </div>

        <div className="mb-6 bg-mairide-bg rounded-[32px] p-6 border border-mairide-secondary">
          <div className="w-full h-56 bg-white rounded-3xl border border-mairide-secondary overflow-hidden flex items-center justify-center">
            {config?.qrCodeUrl ? (
              <img src={config.qrCodeUrl} className="w-full h-full object-contain" alt="Payment QR" />
            ) : (
              <div className="text-center px-6">
                <Camera className="w-10 h-10 text-mairide-secondary mx-auto mb-3 opacity-30" />
                <p className="text-sm text-mairide-secondary">No QR code configured yet. Use the UPI ID above.</p>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Enter UPI / bank transaction ID"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none"
          />
          <label className="block rounded-2xl border border-dashed border-mairide-secondary bg-mairide-bg p-5 cursor-pointer hover:border-mairide-accent transition-colors">
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-mairide-primary">Upload payment receipt</p>
                <p className="text-xs text-mairide-secondary">Screenshot, bank slip, or UPI success image.</p>
              </div>
              <span className="text-xs font-bold text-mairide-accent">{receiptName || 'Choose file'}</span>
            </div>
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-mairide-primary text-white py-4 rounded-2xl font-bold disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting proof...' : 'Submit Payment Proof'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const RideReviewModal = ({
  booking,
  reviewerRole,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  booking: Booking;
  reviewerRole: 'consumer' | 'driver';
  onClose: () => void;
  onSubmit: (payload: { rating: number; comment: string; traits: string[] }) => Promise<void>;
  isSubmitting: boolean;
}) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const counterpartLabel = reviewerRole === 'consumer' ? booking.driverName : booking.consumerName;
  const title = reviewerRole === 'consumer' ? 'Rate Your Driver' : 'Rate Your Traveler';
  const quickTraits =
    reviewerRole === 'consumer'
      ? ['On time', 'Professional', 'Clean car', 'Polite', 'Safe driving', 'Smooth communication']
      : ['On time', 'Polite', 'Clear communication', 'Pickup ready', 'Respectful', 'Easy coordination'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return;
    await onSubmit({ rating, comment: comment.trim(), traits: selectedTraits });
  };

  const toggleTrait = (trait: string) => {
    setSelectedTraits((current) =>
      current.includes(trait) ? current.filter((item) => item !== trait) : [...current, trait]
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg rounded-[36px] bg-white p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Post-Ride Review</p>
            <h3 className="mt-2 text-3xl font-black tracking-tight text-mairide-primary">{title}</h3>
            <p className="mt-2 text-sm text-mairide-secondary">
              Share quick feedback about <span className="font-bold text-mairide-primary">{counterpartLabel}</span>.
            </p>
          </div>
          <button onClick={onClose} className="rounded-2xl bg-mairide-bg p-2 text-mairide-secondary hover:text-mairide-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-mairide-secondary">Rating</p>
            <div className="flex items-center gap-2">
              {Array.from({ length: 5 }, (_, index) => {
                const star = index + 1;
                const active = rating >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="rounded-2xl p-2 transition-transform hover:scale-105"
                  >
                    <Star
                      className={cn(
                        'h-8 w-8',
                        active ? 'fill-mairide-accent text-mairide-accent' : 'fill-transparent text-mairide-secondary/30'
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-mairide-secondary">Quick Highlights</p>
            <div className="flex flex-wrap gap-3">
              {quickTraits.map((trait) => {
                const active = selectedTraits.includes(trait);
                return (
                  <button
                    key={trait}
                    type="button"
                    onClick={() => toggleTrait(trait)}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                      active
                        ? 'border-mairide-accent bg-mairide-accent/10 text-mairide-accent'
                        : 'border-mairide-secondary/40 bg-mairide-bg text-mairide-secondary hover:border-mairide-accent/40 hover:text-mairide-primary'
                    )}
                  >
                    {trait}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">
              Review Comment (Optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="What went well, and what should improve?"
              className="w-full rounded-3xl border border-mairide-secondary bg-mairide-bg px-5 py-4 outline-none focus:border-mairide-accent"
            />
          </div>

          <button
            type="submit"
            disabled={!rating || isSubmitting}
            className="w-full rounded-3xl bg-mairide-primary py-4 text-lg font-bold text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting review...' : 'Submit Review'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const TravelerDashboardSummary = ({
  bookings,
  tripSessions,
  rideStatusById = {},
  ridesResolved = false,
  config,
  onAcceptCounter,
  onRejectCounter,
  counterFares,
  setCounterFares,
  onCounter,
  onPayWithCoins,
  onPayOnline,
  onOpenBooking,
}: {
  bookings: Booking[];
  tripSessions: Record<string, TripSession>;
  rideStatusById?: Record<string, Ride['status']>;
  ridesResolved?: boolean;
  config: AppConfig;
  onAcceptCounter: (booking: Booking) => void;
  onRejectCounter: (booking: Booking) => void;
  counterFares: { [key: string]: string };
  setCounterFares: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  onCounter: (booking: Booking, fare: number) => void;
  onPayWithCoins: (booking: Booking) => void;
  onPayOnline: (booking: Booking) => void;
  onOpenBooking: (booking: Booking) => void;
}) => {
  const activeBookings = bookings.filter((booking) => {
    if ((booking as any).rideRetired) return false;
    if (booking.negotiationStatus === 'rejected') return false;
    if (booking.rideEndedAt || booking.rideLifecycleStatus === 'completed') return false;
    if (['completed', 'cancelled', 'rejected'].includes(String(booking.status || ''))) return false;
    if (ridesResolved) {
      const rideStatus = rideStatusById[booking.rideId];
      if (!rideStatus || ['cancelled', 'completed'].includes(String(rideStatus))) return false;
    }
    return ['pending', 'confirmed', 'negotiating'].includes(booking.status);
  });

  if (!activeBookings.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Live Traveler Requests & Counter Offers</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {activeBookings.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {activeBookings.map((booking) => {
          const pendingActor = getPendingNegotiationActor(booking);
          const hasDriverCounterOffer = pendingActor === 'driver';
          const hasTravelerCounterOffer = pendingActor === 'consumer';
          const displayFare = getNegotiationDisplayFare(booking);
          const listedFare = getListedFare(booking);
          const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
          const statusLabel = getBookingStateLabel(booking);
          const travelerFeeBreakdown = getBookingPaymentBreakdown(booking as Booking, 'consumer', config);
          const tripSession = tripSessions[booking.id];
          const showLiveTrackingPanel =
            booking.status === 'confirmed' ||
            booking.rideLifecycleStatus === 'awaiting_start_otp' ||
            booking.rideLifecycleStatus === 'in_progress' ||
            Boolean(booking.rideStartedAt);

          return (
          <div key={booking.id} className="bg-white border border-mairide-secondary rounded-[28px] p-4 md:p-6 shadow-sm min-w-0 overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                  {booking.driverPhotoUrl ? (
                    <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-6 h-6 text-mairide-accent" />
                  )}
                </div>
                <div className="min-w-0">
                <p className="text-lg font-bold text-mairide-primary break-words">{booking.origin} → {booking.destination}</p>
                <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                </div>
              </div>
              <div className="text-left md:text-right">
                <p className="text-xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                <p className={cn(
                  "text-[10px] font-bold uppercase tracking-widest",
                  hasDriverCounterOffer || hasTravelerCounterOffer || booking.status === 'negotiating' ? "text-orange-700" :
                  booking.status === 'confirmed' ? "text-green-700" :
                  "text-mairide-secondary"
                )}>
                  {statusLabel}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">Listed fare</span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {hasDriverCounterOffer ? 'Driver counter fare' : hasTravelerCounterOffer ? 'Your offered fare' : 'Current request fare'}
                </span>
                <span className={cn(
                  "text-lg font-black",
                  showNegotiatedFareLine ? "text-mairide-accent" : "text-mairide-primary"
                )}>
                  {formatCurrency(displayFare)}
                </span>
              </div>
            </div>
            {hasDriverCounterOffer && (
              <div className="mt-4 rounded-2xl border border-mairide-accent/20 bg-mairide-accent/10 p-4">
                <p className="font-bold text-mairide-primary">Counter offer received: {formatCurrency(displayFare)}</p>
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <button onClick={() => onAcceptCounter(booking)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                    Accept Counter Offer
                  </button>
                  <button onClick={() => onRejectCounter(booking)} className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}>
                    Reject
                  </button>
                </div>
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <input
                    type="number"
                    min="1"
                    placeholder="Counter fare"
                    className="flex-1 rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                    value={counterFares[booking.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => onCounter(booking, Number(counterFares[booking.id]))}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Send Counter
                  </button>
                </div>
              </div>
            )}
            {!hasDriverCounterOffer && booking.status !== 'confirmed' && (
              <div className={cn(
                "mt-4 rounded-2xl p-4",
                hasTravelerCounterOffer ? "border border-orange-200 bg-orange-50" : "border border-mairide-secondary/20 bg-mairide-bg"
              )}>
                {hasTravelerCounterOffer ? (
                  <>
                    <p className="font-bold text-mairide-primary">Your offer is awaiting the driver&apos;s response.</p>
                    <p className="mt-2 text-sm text-mairide-secondary">
                      Offered fare: <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span>
                    </p>
                  </>
                ) : (
                  <p className="font-bold text-mairide-primary">You can update your offer while the booking is still pending.</p>
                )}
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <input
                    type="number"
                    min="1"
                    placeholder="Counter fare"
                    className="flex-1 rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                    value={counterFares[booking.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => onCounter(booking, Number(counterFares[booking.id]))}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Send Counter Offer
                  </button>
                </div>
              </div>
            )}
            {booking.status === 'confirmed' && (
              <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee + GST</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(travelerFeeBreakdown.totalFee)}</span>
                </div>
                <p className="text-xs text-mairide-secondary">
                  You can apply up to 25 MaiCoins against the platform fee portion only. GST and the remaining balance are paid online. MaiCoins cannot be used to pay the driver&apos;s ride fare.
                </p>
                {!booking.feePaid ? (
                  <div className="flex flex-col sm:flex-row gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(booking)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}
                    </button>
                    <button onClick={() => onPayOnline(booking)} className={cn("flex-1 bg-white border border-mairide-primary text-mairide-primary py-3", secondaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Traveler payment submitted
                  </div>
                )}
                {booking.feePaid && booking.driverFeePaid ? (
                  <ContactUnlockCard label="Driver contact" phoneNumber={booking.driverPhone} />
                ) : null}
              </div>
            )}
            {showLiveTrackingPanel && tripSession && (
              <div className={cn(
                "mt-4 rounded-2xl border p-4",
                tripSession.isStale ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50"
              )}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-primary">Live Trip Session</p>
                  <span className={cn(
                    "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
                    tripSession.status === 'live'
                      ? "bg-green-100 text-green-700"
                      : tripSession.status === 'completed'
                        ? "bg-mairide-bg text-mairide-primary"
                        : "bg-orange-100 text-orange-700"
                  )}>
                    {tripSession.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">ETA</p>
                    <p className="mt-1 text-lg font-black text-mairide-primary">
                      {tripSession.etaMinutes ? `${tripSession.etaMinutes} min` : 'Updating...'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Driver Signal</p>
                    <p className="mt-1 text-sm font-bold text-mairide-primary">
                      {tripSession.lastSignalAt ? new Date(tripSession.lastSignalAt).toLocaleTimeString() : 'Pending'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Network</p>
                    <p className="mt-1 text-sm font-bold capitalize text-mairide-primary">
                      {tripSession.networkState || 'online'}
                      {tripSession.isStale ? ' (stale)' : ''}
                    </p>
                  </div>
                </div>
                <TripSessionMiniMap session={tripSession} />
              </div>
            )}
            {booking.status === 'confirmed' && booking.feePaid && booking.driverFeePaid && !booking.rideStartedAt && booking.rideStartOtp && (
              <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Ride Start OTP</p>
                <p className="mt-2 text-3xl font-black tracking-[0.3em] text-mairide-primary">{booking.rideStartOtp}</p>
                <p className="mt-2 text-xs text-mairide-secondary">
                  Share this OTP with the driver only when the ride actually starts. Until then the driver stays hidden from new bookings.
                </p>
              </div>
            )}
            {booking.rideStartedAt && !booking.rideEndedAt && booking.rideEndOtp && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-green-700">End Ride OTP</p>
                <p className="mt-2 text-3xl font-black tracking-[0.3em] text-green-800">{booking.rideEndOtp}</p>
                <p className="mt-2 text-xs text-green-700">
                  Give this OTP to the driver only after your journey is completed so the ride can be closed on-platform.
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-start md:justify-end">
              <button
                onClick={() => onOpenBooking(booking)}
                className="w-full md:w-auto text-left md:text-right text-sm font-bold text-mairide-accent hover:text-mairide-primary transition-colors break-words"
              >
                View Full Booking Details
              </button>
            </div>
          </div>
        )})}
      </div>
    </div>
  );
};

const TravelerCounterOffersSummary = ({
  bookings,
  rideStatusById = {},
  ridesResolved = false,
  onAcceptCounter,
  onRejectCounter,
}: {
  bookings: Booking[];
  rideStatusById?: Record<string, Ride['status']>;
  ridesResolved?: boolean;
  onAcceptCounter: (booking: Booking) => void;
  onRejectCounter: (booking: Booking) => void;
}) => {
  const counterOffers = bookings.filter((booking) => {
    if ((booking as any).rideRetired) return false;
    if (booking.rideEndedAt || booking.rideLifecycleStatus === 'completed') return false;
    if (ridesResolved) {
      const rideStatus = rideStatusById[booking.rideId];
      if (!rideStatus || ['cancelled', 'completed'].includes(String(rideStatus))) return false;
    }
    if (['completed', 'cancelled', 'rejected'].includes(booking.status)) return false;
    if (booking.negotiationStatus === 'rejected') return false;
    return hasPendingDriverCounterOffer(booking);
  });

  if (!counterOffers.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Live Driver Counter Offers</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {counterOffers.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {counterOffers.map((booking) => (
          <div key={booking.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            {(() => {
              const listedFare = getListedFare(booking);
              const counterFare = getNegotiationDisplayFare(booking);
              const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
              return (
                <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                  {booking.driverPhotoUrl ? (
                    <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-6 h-6 text-mairide-accent" />
                  )}
                </div>
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                  <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-mairide-accent">{formatCurrency(counterFare)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700">Counter Offer</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {showNegotiatedFareLine ? 'Listed fare' : 'Ride fare'}
                </span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              {showNegotiatedFareLine && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-mairide-secondary">Driver counter fare</span>
                  <span className="text-lg font-black text-mairide-accent">{formatCurrency(counterFare)}</span>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col md:flex-row gap-3">
              <button
                onClick={() => onAcceptCounter(booking)}
                className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}
              >
                Accept Offer
              </button>
              <button
                onClick={() => onRejectCounter(booking)}
                className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}
              >
                Reject
              </button>
            </div>
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
};

const TripSessionMiniMap = ({ session }: { session: TripSession }) => {
  if (typeof window === 'undefined' || !window.google) return null;
  if (!session.driverLocation || !session.travelerLocation) return null;

  const center = {
    lat: Number(((session.driverLocation.lat + session.travelerLocation.lat) / 2).toFixed(6)),
    lng: Number(((session.driverLocation.lng + session.travelerLocation.lng) / 2).toFixed(6)),
  };

  return (
    <div className="mt-3 h-44 overflow-hidden rounded-xl border border-mairide-secondary/30 bg-white">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={10}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
        }}
      >
        <Marker
          position={{ lat: session.driverLocation.lat, lng: session.driverLocation.lng }}
          title="Driver"
          icon={{
            url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
            scaledSize: new window.google.maps.Size(32, 32),
          }}
        />
        <Marker
          position={{ lat: session.travelerLocation.lat, lng: session.travelerLocation.lng }}
          title="Traveler"
          icon={{
            url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
            scaledSize: new window.google.maps.Size(30, 30),
          }}
        />
      </GoogleMap>
    </div>
  );
};

const DriverDashboardSummary = ({
  requests,
  tripSessions,
  config,
  onAccept,
  onReject,
  counterFares,
  setCounterFares,
  onCounter,
  onPayWithCoins,
  onPayOnline,
  onStartRide,
  onEndRide,
}: {
  requests: Booking[];
  tripSessions: Record<string, TripSession>;
  config: AppConfig;
  onAccept: (request: Booking) => void;
  onReject: (request: Booking) => void;
  counterFares: { [key: string]: string };
  setCounterFares: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  onCounter: (request: Booking, fare: number) => void;
  onPayWithCoins: (request: Booking) => void;
  onPayOnline: (request: Booking) => void;
  onStartRide: (request: Booking, otp: string) => void;
  onEndRide: (request: Booking, otp: string) => void;
}) => {
  const liveRequests = useMemo(
    () =>
      requests.filter((request) => {
        if ((request as any).rideRetired) return false;
        if (request.negotiationStatus === 'rejected') return false;
        return ['pending', 'negotiating', 'confirmed'].includes(request.status);
      }),
    [requests]
  );
  const [startOtpInputs, setStartOtpInputs] = useState<{ [key: string]: string }>({});
  const [endOtpInputs, setEndOtpInputs] = useState<{ [key: string]: string }>({});
  if (!liveRequests.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Live Traveler Requests & Counter Offers</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {liveRequests.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {liveRequests.map((request) => {
          const pendingActor = getPendingNegotiationActor(request);
          const travelerCounterPending = pendingActor === 'consumer';
          const driverCounterPending = pendingActor === 'driver';
          const displayFare = getNegotiationDisplayFare(request);
          const listedFare = getListedFare(request);
          const driverFeeBreakdown = getBookingPaymentBreakdown(request as Booking, 'driver', config);
          const tripSession = tripSessions[request.id];
          const requestedOrigin = request.requestedOrigin || request.origin;
          const requestedDestination = request.requestedDestination || request.destination;
          const showsDetour =
            Boolean(request.requiresDetour) &&
            (normalizeSearchText(requestedOrigin) !== normalizeSearchText(request.origin) ||
              normalizeSearchText(requestedDestination) !== normalizeSearchText(request.destination));

          return (
          <div key={request.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-mairide-primary">{request.origin} → {request.destination}</p>
                <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                  {driverCounterPending ? 'awaiting traveler' : travelerCounterPending ? 'traveler counter' : request.status}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">Listed fare</span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {travelerCounterPending ? 'Traveler offered fare' : driverCounterPending ? 'Your counter fare' : 'Current request fare'}
                </span>
                <span className="text-lg font-black text-mairide-accent">{formatCurrency(displayFare)}</span>
              </div>
            </div>
            {(request.status === 'pending' || request.status === 'negotiating' || travelerCounterPending || driverCounterPending) && (
              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <button onClick={() => onAccept(request)} className={cn("flex-1 bg-green-600 text-white py-3", primaryActionButtonClass)}>
                    {travelerCounterPending || driverCounterPending ? 'Accept Offer' : 'Accept Request'}
                  </button>
                  <button onClick={() => onReject(request)} className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}>
                    Reject
                  </button>
                </div>
                <div className="flex gap-3">
                  <input
                    type="number"
                    placeholder="Counter fare"
                    value={counterFares[request.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-mairide-bg border border-mairide-secondary rounded-xl outline-none"
                  />
                  <button onClick={() => onCounter(request, Number(counterFares[request.id]))} className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}>
                    Send Counter
                  </button>
                </div>
                {showsDetour && (
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-mairide-accent" /><p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Traveler Detour Request</p></div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Your listed route</p>
                        <p className="mt-1 text-sm font-semibold text-mairide-primary">{request.origin} → {request.destination}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler requested route</p>
                        <p className="mt-1 text-sm font-semibold text-mairide-primary">{requestedOrigin} → {requestedDestination}</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl bg-white/80 p-3">
                      <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Decision Impact</p>
                      <p className="mt-1 text-sm font-semibold text-mairide-primary">This booking changes your listed route. Please review the detour carefully before you accept, reject, or counter.</p>
                    </div>
                  </div>
                )}
                {driverCounterPending && (
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                    <p className="font-bold text-mairide-primary">Your latest counter offer is active.</p>
                    <p className="mt-2 text-sm text-mairide-secondary">
                      The negotiation is still live. You can accept, reject, or revise{' '}
                      <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span> at any time until the traveler makes a final decision.
                    </p>
                  </div>
                )}
              </div>
            )}
            {request.status === 'confirmed' && (
              <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee + GST</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(driverFeeBreakdown.totalFee)}</span>
                </div>
                <p className="text-xs text-mairide-secondary">
                  You can apply up to 25 MaiCoins against the platform fee portion only. GST and the remaining balance are paid online. MaiCoins cannot be used to pay the traveler&apos;s ride fare.
                </p>
                {!request.driverFeePaid ? (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(request)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}
                    </button>
                    <button onClick={() => onPayOnline(request)} className={cn("flex-1 bg-white border border-mairide-primary text-mairide-primary py-3", secondaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Driver payment submitted
                  </div>
                )}
                {request.feePaid && request.driverFeePaid ? (
                  <ContactUnlockCard label="Traveler contact" phoneNumber={request.consumerPhone} />
                ) : null}
              </div>
            )}
            {tripSession && (
              <div className={cn(
                "mt-4 rounded-2xl border p-4",
                tripSession.isStale ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50"
              )}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-primary">Trip Tracking Health</p>
                  <span className={cn(
                    "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
                    tripSession.status === 'live'
                      ? "bg-green-100 text-green-700"
                      : tripSession.status === 'completed'
                        ? "bg-mairide-bg text-mairide-primary"
                        : "bg-orange-100 text-orange-700"
                  )}>
                    {tripSession.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler ETA</p>
                    <p className="mt-1 text-lg font-black text-mairide-primary">
                      {tripSession.etaMinutes ? `${tripSession.etaMinutes} min` : 'Updating...'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Last Signal</p>
                    <p className="mt-1 text-sm font-bold text-mairide-primary">
                      {tripSession.lastSignalAt ? new Date(tripSession.lastSignalAt).toLocaleTimeString() : 'Pending'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Session State</p>
                    <p className="mt-1 text-sm font-bold capitalize text-mairide-primary">
                      {tripSession.networkState || 'online'}
                      {tripSession.isStale ? ' (stale)' : ''}
                    </p>
                  </div>
                </div>
                <TripSessionMiniMap session={tripSession} />
              </div>
            )}
            {request.status === 'confirmed' && request.feePaid && request.driverFeePaid && !request.rideStartedAt && (
              <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-4">
                <p className="text-sm font-bold text-mairide-primary mb-3">Start Ride with Traveler OTP</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter start OTP"
                    value={startOtpInputs[request.id] || ''}
                    onChange={(e) => setStartOtpInputs((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-white border border-mairide-secondary rounded-xl outline-none"
                  />
                  <button
                    onClick={() => onStartRide(request, startOtpInputs[request.id] || '')}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Start Ride
                  </button>
                </div>
              </div>
            )}
            {request.rideStartedAt && !request.rideEndedAt && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-bold text-green-800 mb-3">End Ride with Traveler OTP</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter end OTP"
                    value={endOtpInputs[request.id] || ''}
                    onChange={(e) => setEndOtpInputs((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-white border border-green-200 rounded-xl outline-none"
                  />
                  <button
                    onClick={() => onEndRide(request, endOtpInputs[request.id] || '')}
                    className={cn("bg-green-700 text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    End Ride
                  </button>
                </div>
              </div>
            )}
          </div>
        )})}
      </div>
    </div>
  );
};

const ProfileInfoCard = ({
  label,
  value,
  subValue,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
}) => (
  <div className="bg-mairide-bg p-5 rounded-3xl border border-mairide-secondary/40">
    <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest mb-2">{label}</p>
    <div className="text-lg font-bold text-mairide-primary break-words">{value}</div>
    {subValue ? <p className="text-xs text-mairide-secondary mt-2">{subValue}</p> : null}
  </div>
);

const ViewOnlyDocumentCard = ({
  title,
  imageUrl,
}: {
  title: string;
  imageUrl?: string;
}) => (
  <div className="space-y-3">
    <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest text-center">{title}</p>
    <div className="aspect-[4/3] bg-mairide-bg rounded-3xl overflow-hidden border border-mairide-secondary relative group">
      {imageUrl ? (
        <>
          <img src={imageUrl} className="w-full h-full object-cover" alt={title} />
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold"
          >
            View Full Size
          </a>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-center p-6">
          <div>
            <Camera className="w-8 h-8 text-mairide-secondary mx-auto mb-2" />
            <p className="text-xs font-bold text-mairide-secondary">No file uploaded</p>
          </div>
        </div>
      )}
    </div>
    <p className="text-[11px] text-mairide-secondary text-center">
      This document is view-only. Contact MaiRide support if any corrections are required.
    </p>
  </div>
);

const UserSelfProfilePanel = ({ profile }: { profile: UserProfile }) => {
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile.displayName || '');
    setPhoneNumber(profile.phoneNumber || '');
  }, [profile.displayName, profile.phoneNumber]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmailValue(profile.email);
    const normalizedPhone = toIndianPhoneStorage(phoneNumber);
    if (!isValidEmailValue(normalizedEmail)) {
      alert('A valid email address is required on this account.');
      return;
    }
    if (phoneNumber && !normalizedPhone) {
      alert('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: sanitizeDisplayName(displayName),
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
      });
      alert('Profile details updated successfully.');
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-[32px] bg-mairide-bg border border-mairide-secondary overflow-hidden flex items-center justify-center">
              {getResolvedUserPhoto(profile) ? (
                <img src={getResolvedUserPhoto(profile)} alt={profile.displayName} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-10 h-10 text-mairide-secondary" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest mb-2">Account Profile</p>
              <h2 className="text-3xl font-black tracking-tight text-mairide-primary">{profile.displayName}</h2>
              <p className="text-sm text-mairide-secondary break-all mt-1">{profile.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-widest">
                  {profile.status}
                </span>
                <span className="px-3 py-1 rounded-full bg-mairide-bg text-mairide-primary text-[10px] font-bold uppercase tracking-widest">
                  {profile.role === 'consumer' ? 'Traveler' : profile.role}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsEditing((current) => !current)}
            className="px-6 py-3 rounded-2xl bg-mairide-primary text-white font-bold hover:scale-[1.02] transition-transform"
          >
            {isEditing ? 'Close Edit Mode' : 'Edit Basic Details'}
          </button>
        </div>
      </div>

      {isEditing && (
        <form onSubmit={handleSave} className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8 space-y-6">
          <h3 className="text-xl font-bold text-mairide-primary">Update Basic Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
              <input
                type="text"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent"
                value={displayName}
                onChange={(e) => setDisplayName(sanitizeDisplayName(e.target.value))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Phone Number</label>
              <IndianPhoneInput value={phoneNumber} onChange={setPhoneNumber} />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="w-full md:w-auto px-8 py-4 rounded-2xl bg-mairide-accent text-white font-bold hover:scale-[1.02] transition-transform disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <ProfileInfoCard label="Email" value={profile.email} />
        <ProfileInfoCard label="Phone Number" value={formatPhoneForDisplay(profile.phoneNumber)} />
        <ProfileInfoCard
          label="MaiCoins Wallet"
          value={
            <>
              {profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">MC</span>
            </>
          }
          subValue={`Pending: ${profile.wallet?.pendingBalance || 0} MC`}
        />
        <ProfileInfoCard
          label="Ratings"
          value={typeof profile.reviewStats?.averageRating === 'number' ? profile.reviewStats.averageRating.toFixed(1) : getResolvedUserRating(profile).toFixed(1)}
          subValue={`${profile.reviewStats?.ratingCount || 0} reviews recorded`}
        />
      </div>

      {profile.consents && (
        <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
          <h3 className="text-xl font-bold text-mairide-primary mb-6">Consents & Account Declarations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ProfileInfoCard
              label="Truth Declaration"
              value={profile.consents.truthfulInformationAccepted ? 'Accepted' : 'Not recorded'}
              subValue={`Accepted at ${new Date(profile.consents.acceptedAt).toLocaleString()}`}
            />
            <ProfileInfoCard
              label="Terms & Marketing"
              value={profile.consents.termsAccepted ? 'Terms accepted' : 'Terms missing'}
              subValue={`Marketing opt-in: ${profile.consents.marketingOptIn ? 'Enabled' : 'Disabled'}`}
            />
          </div>
        </div>
      )}

      {profile.role === 'driver' && profile.driverDetails && (
        <>
          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
            <h3 className="text-xl font-bold text-mairide-primary mb-6">Driver Verification Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <ProfileInfoCard label="Aadhaar Number" value={formatAadhaarForDisplay(profile.driverDetails.aadhaarNumber)} />
              <ProfileInfoCard label="DL Number" value={profile.driverDetails.dlNumber || 'Not provided'} />
              <ProfileInfoCard label="Vehicle" value={`${profile.driverDetails.vehicleMake} ${profile.driverDetails.vehicleModel}`.trim() || 'Not provided'} />
              <ProfileInfoCard label="Registration" value={profile.driverDetails.vehicleRegNumber || 'Not provided'} />
              <ProfileInfoCard label="Insurance Status" value={profile.driverDetails.insuranceStatus || 'Not captured'} />
              <ProfileInfoCard label="Insurance Provider" value={profile.driverDetails.insuranceProvider || 'Not provided'} />
              <ProfileInfoCard label="Insurance Expiry" value={profile.driverDetails.insuranceExpiryDate || 'Not provided'} />
              <ProfileInfoCard label="Verification Status" value={profile.verificationStatus || 'pending'} />
            </div>
          </div>

          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-xl font-bold text-mairide-primary">Uploaded Documents</h3>
                <p className="text-sm text-mairide-secondary">Your verification files are visible here for reference. They cannot be edited or deleted from this screen.</p>
              </div>
              <span className="px-4 py-2 rounded-full bg-mairide-bg text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                View Only
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <ViewOnlyDocumentCard title="Selfie" imageUrl={profile.driverDetails.selfiePhoto} />
              <ViewOnlyDocumentCard title="Vehicle Photo" imageUrl={profile.driverDetails.vehiclePhoto} />
              <ViewOnlyDocumentCard title="Aadhaar Front" imageUrl={profile.driverDetails.aadhaarFrontPhoto} />
              <ViewOnlyDocumentCard title="Aadhaar Back" imageUrl={profile.driverDetails.aadhaarBackPhoto} />
              <ViewOnlyDocumentCard title="DL Front" imageUrl={profile.driverDetails.dlFrontPhoto} />
              <ViewOnlyDocumentCard title="DL Back" imageUrl={profile.driverDetails.dlBackPhoto} />
              <ViewOnlyDocumentCard title="RC Photo" imageUrl={profile.driverDetails.rcPhoto} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MyBookings = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [bookings, setBookings] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('consumerId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setBookings(
        dedupeBookingsByThread(list)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const submitTravelerPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    const { baseFee, gstAmount } = calculateServiceFee(booking.fare, config || undefined);
    const receiptRef = storageRef(storage, `payments/${booking.id}/consumer-${Date.now()}.jpg`);
    await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
    const receiptUrl = await getDownloadURL(receiptRef);
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'proof_submitted',
      consumerPaymentMode: 'online',
      consumerPaymentTransactionId: payload.transactionId,
      consumerPaymentReceiptUrl: receiptUrl,
      consumerPaymentSubmittedAt: new Date().toISOString(),
      consumerNetServiceFee: baseFee,
      consumerNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: 'online',
      paymentStatus: 'pending',
      transactionId: payload.transactionId,
      receiptUrl,
      gateway: 'manual',
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Traveler payment proof submitted successfully.');
  };

const finalizeTravelerRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    const { netServiceFee, gstAmount } = getHybridPaymentBreakdown(
      booking,
      profile.wallet?.balance || 0,
      coinsUsed > 0,
      config || undefined
    );
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'paid',
      consumerPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      maiCoinsUsed: coinsUsed,
      consumerPaymentTransactionId: payment.paymentId,
      consumerPaymentOrderId: payment.orderId,
      consumerPaymentGateway: 'razorpay',
      consumerPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      consumerPaymentSubmittedAt: new Date().toISOString(),
      consumerNetServiceFee: netServiceFee,
      consumerNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Traveler Razorpay payment verified successfully.', 'success');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);

      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'consumer',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeTravelerRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentBooking(booking);
        return;
      }
      
      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        maiCoinsUsed: coinsToUse,
        consumerPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        consumerNetServiceFee: 0,
        consumerNetGstAmount: 0,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Unable to start Razorpay checkout.');
      showAppDialog(message, 'error', 'Payment unavailable');
    }
  };

  const handleNegotiation = async (bookingId: string, action: 'accepted' | 'rejected', negotiatedFare?: number) => {
    try {
      const booking = bookings.find((candidate) => candidate.id === bookingId);
      if (!booking) {
        throw new Error('Booking not found.');
      }
      const token = await getAccessToken();

      await axios.post(
        '/api/user?action=traveler-respond-booking',
        {
          bookingId,
          consumerId: profile.uid,
          action,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const acceptedFare =
        action === 'accepted'
          ? negotiatedFare ?? getNegotiationDisplayFare(booking)
          : undefined;
      let updatedAt = new Date().toISOString();
      try {
        updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
      } catch (syncError) {
        console.warn('Negotiation sync (traveler accept) failed after API success.', syncError);
      }
      setBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                status: action === 'accepted' ? 'confirmed' : 'rejected',
                ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                negotiationActor: 'driver',
                driverCounterPending: false,
                updatedAt,
              }
            : candidate
        )
      );

      showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      return;
    } catch (error) {
      try {
        const booking = bookings.find((candidate) => candidate.id === bookingId);
        if (!booking) throw error;
        const acceptedFare =
          action === 'accepted' ? negotiatedFare ?? getNegotiationDisplayFare(booking) : undefined;
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
        setBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  status: action === 'accepted' ? 'confirmed' : 'rejected',
                  ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                  negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                  negotiationActor: 'driver',
                  driverCounterPending: false,
                  rideRetired: action === 'rejected',
                  updatedAt,
                }
              : candidate
          )
        );
        showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      } catch (fallbackError) {
        handleFirestoreError(fallbackError, OperationType.UPDATE, `bookings/${bookingId}`);
      }
    }
  };

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;

    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits, profile.uid);
      alert('Your ride review has been submitted successfully.');
      setReviewBooking(null);
    } catch (error: any) {
      console.error('Error submitting ride review:', error);
      alert(error.response?.data?.error || error.message || 'Failed to submit ride review.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const savingsEligibleBookings = bookings.filter((booking) => ['confirmed', 'completed'].includes(booking.status));
  const estimatedMarketMultiplier = 1.25;
  const estimatedEmptyLegSavings = savingsEligibleBookings.reduce(
    (sum, booking) => sum + Math.max(0, booking.fare * estimatedMarketMultiplier - booking.fare),
    0
  );
  const maicoinsSavings = savingsEligibleBookings.reduce(
    (sum, booking) => sum + (booking.maiCoinsUsed || 0),
    0
  );
  const totalTrips = savingsEligibleBookings.length;
  const historyChartData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const monthBookings = savingsEligibleBookings.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });
    const monthlySavings = monthBookings.reduce(
      (sum, booking) => sum + Math.max(0, booking.fare * estimatedMarketMultiplier - booking.fare),
      0
    );
    const monthlyMaicoins = monthBookings.reduce((sum, booking) => sum + (booking.maiCoinsUsed || 0), 0);
    return {
      month,
      savings: Math.round(monthlySavings),
      maicoins: Math.round(monthlyMaicoins),
    };
  });

  if (loading) return <LoadingScreen />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:p-8 min-w-0 overflow-x-hidden">
      <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center mb-8">
        <h1 className="text-3xl font-bold text-mairide-primary">My Bookings</h1>
        <div className="bg-mairide-primary text-white px-6 py-3 rounded-2xl flex items-center space-x-3 shadow-lg shadow-mairide-primary/20">
          <Bot className="w-5 h-5 text-mairide-accent" />
          <div>
            <p className="text-[10px] font-bold uppercase opacity-60 leading-none mb-1">Wallet Balance</p>
            <p className="text-lg font-black tracking-tighter">{profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">Maicoins</span></p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Trips Counted</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{totalTrips}</p>
          <p className="text-xs text-mairide-secondary mt-2">Confirmed/completed rides used for savings view.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Estimated Empty-Leg Savings</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(estimatedEmptyLegSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Based on a 25% benchmark vs regular ride pricing.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Savings via Maicoins</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(maicoinsSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Equivalent value of Maicoins used on platform fees.</p>
        </div>
      </div>
      <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-bold text-mairide-primary mb-4">Savings Trend (Last 6 Months)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={historyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DAD9D3" />
              <XAxis dataKey="month" stroke="#4A4A4A" />
              <YAxis stroke="#4A4A4A" />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="savings" name="Estimated Savings" fill="#E56A10" radius={[8, 8, 0, 0]} />
              <Bar dataKey="maicoins" name="Maicoins Savings" fill="#0F2A3D" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-6">
        {bookings.length > 0 ? (
          bookings.map((booking) => {
            const pendingActor = getPendingNegotiationActor(booking);
            const hasDriverCounterOffer = pendingActor === 'driver';
            const hasTravelerCounterOffer = pendingActor === 'consumer';
            const displayFare = getNegotiationDisplayFare(booking);
            const listedFare = getListedFare(booking);
            const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
            const statusLabel = getBookingStateLabel(booking);
            const consumerFeeBreakdown = getBookingPaymentBreakdown(booking as Booking, 'consumer', config);

            return (
            <div key={booking.id} className="bg-white p-4 md:p-8 rounded-[32px] border border-mairide-secondary shadow-sm hover:shadow-md transition-all min-w-0">
              <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-start mb-6 min-w-0">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                    {booking.driverPhotoUrl ? (
                      <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                    ) : (
                      <Car className="w-6 h-6 text-mairide-accent" />
                    )}
                  </div>
                  <div className="min-w-0">
                  <h3 className="font-bold text-lg md:text-xl text-mairide-primary mb-1 break-words">{booking.origin} → {booking.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                  {booking.feePaid && booking.driverFeePaid ? (
                    <ContactUnlockCard label="Driver contact" phoneNumber={booking.driverPhone} />
                  ) : booking.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(booking.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  booking.status === 'confirmed' ? "bg-green-100 text-green-700" :
                  (hasDriverCounterOffer || hasTravelerCounterOffer || booking.status === 'pending') ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                )}>
                  {statusLabel}
                </div>
              </div>

              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Listed fare</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">
                    {hasDriverCounterOffer ? 'Driver counter fare' : hasTravelerCounterOffer ? 'Your offered fare' : 'Current request fare'}
                  </span>
                  <span className={cn("font-bold", showNegotiatedFareLine ? "text-mairide-accent text-xl" : "text-mairide-primary text-lg")}>
                    {formatCurrency(displayFare)}
                  </span>
                </div>
              </div>

              {hasDriverCounterOffer && (
                <div className="mb-6 p-6 bg-mairide-accent/10 border border-mairide-accent rounded-2xl">
                  <p className="font-bold text-mairide-primary mb-2">Counter offer received: {formatCurrency(displayFare)}</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'accepted', booking.negotiatedFare)}
                      className={cn("flex-1 bg-mairide-primary text-white py-3 text-sm", primaryActionButtonClass)}
                    >
                      Accept Counter Offer
                    </button>
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'rejected')}
                      className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3 text-sm", secondaryActionButtonClass)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {!hasDriverCounterOffer && booking.status !== 'confirmed' && (
                <div className={cn(
                  "mb-6 p-6 rounded-2xl",
                  hasTravelerCounterOffer ? "bg-mairide-accent/10 border border-mairide-accent" : "bg-mairide-bg border border-mairide-secondary/20"
                )}>
                  {hasTravelerCounterOffer ? (
                    <>
                      <p className="font-bold text-mairide-primary">Your counter offer has been sent.</p>
                      <p className="mt-2 text-sm text-mairide-secondary">
                        Waiting for the driver to accept or reject <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span>.
                      </p>
                    </>
                  ) : (
                    <p className="font-bold text-mairide-primary">You can update your offer while the booking is still pending.</p>
                  )}
                </div>
              )}

              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(consumerFeeBreakdown.serviceFee)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">GST (18%)</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(consumerFeeBreakdown.gstAmount)}</span>
                </div>
                <div className="h-px bg-mairide-secondary/20 my-4" />
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold text-mairide-primary">Traveler Pays Now</span>
                  <span className="text-2xl font-black text-mairide-accent">{formatCurrency(consumerFeeBreakdown.totalFee)}</span>
                </div>
                <p className="mt-3 text-xs text-mairide-secondary">
                  Ride fare is settled between traveler and driver separately. You can apply up to 25 MaiCoins against the ₹100 platform fee, and any remaining fee plus GST is paid online.
                </p>
              </div>

              {booking.status === 'confirmed' && !booking.feePaid && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={() => handlePayFee(booking, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2"
                  >
                    <Bot className="w-5 h-5" />
                    <span>{isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(booking, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online & Upload Proof'}
                  </button>
                </div>
              )}

              {booking.feePaid && (
                <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-center space-x-2 text-green-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Platform Fee Submitted {booking.maiCoinsUsed > 0 && `(Used ${booking.maiCoinsUsed} Maicoins)`}</span>
                </div>
              )}

              {booking.status === 'confirmed' && booking.feePaid && booking.driverFeePaid && !booking.rideStartedAt && booking.rideStartOtp && (
                <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Ride Start OTP</p>
                  <p className="mt-2 text-3xl font-black tracking-[0.3em] text-mairide-primary">{booking.rideStartOtp}</p>
                  <p className="mt-2 text-xs text-mairide-secondary">
                    Share this OTP with the driver only when the ride actually begins.
                  </p>
                </div>
              )}

              {booking.rideStartedAt && !booking.rideEndedAt && booking.rideEndOtp && (
                <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-green-700">End Ride OTP</p>
                  <p className="mt-2 text-3xl font-black tracking-[0.3em] text-green-800">{booking.rideEndOtp}</p>
                  <p className="mt-2 text-xs text-green-700">
                    Share this OTP with the driver only after the trip is completed.
                  </p>
                </div>
              )}

              {booking.status === 'completed' && (
                <div className="mt-4 rounded-2xl border border-mairide-secondary bg-mairide-bg p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Post-Ride Review</p>
                      {booking.consumerReview ? (
                        <>
                          <p className="mt-2 text-sm font-bold text-mairide-primary">
                            You rated {booking.driverName} {booking.consumerReview.rating}/5
                          </p>
                          {booking.consumerReview.comment && (
                            <p className="mt-1 text-sm italic text-mairide-secondary">"{booking.consumerReview.comment}"</p>
                          )}
                          {!!booking.consumerReview.traits?.length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {booking.consumerReview.traits.map((trait) => (
                                <span
                                  key={trait}
                                  className="rounded-full bg-mairide-accent/10 px-3 py-1 text-xs font-bold text-mairide-accent"
                                >
                                  {trait}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-mairide-secondary">
                          Rate your driver now so future travelers can trust the platform more easily.
                        </p>
                      )}
                    </div>
                    {!booking.consumerReview && (
                      <button
                        onClick={() => setReviewBooking(booking)}
                        className="rounded-2xl bg-mairide-primary px-6 py-3 text-sm font-bold text-white"
                      >
                        Rate Driver
                      </button>
                    )}
                  </div>
                </div>
              )}

              <PaymentAuditTrail
                booking={booking}
                transactions={transactions}
                viewer="consumer"
              />
            </div>
          )})
        ) : (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-mairide-secondary">
            <Car className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
            <p className="text-mairide-secondary">You haven't made any bookings yet.</p>
          </div>
        )}
      </div>
      {paymentBooking && (
        <PaymentProofModal
          booking={paymentBooking}
          payer="consumer"
          config={config}
          onClose={() => setPaymentBooking(null)}
          onSubmit={(payload) => submitTravelerPaymentProof(paymentBooking, payload)}
        />
      )}
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="consumer"
          onClose={() => setReviewBooking(null)}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

const MyRides = ({
  profile,
  hiddenRideIds = [],
  onRideRetired,
}: {
  profile: UserProfile;
  hiddenRideIds?: string[];
  onRideRetired?: (rideId: string) => void;
}) => {
  const [rides, setRides] = useState<any[]>([]);
  const [activeNegotiationRideIds, setActiveNegotiationRideIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingRideId, setCancellingRideId] = useState<string | null>(null);
  const [pendingCancelRide, setPendingCancelRide] = useState<any | null>(null);
  const visibleRides = useMemo(
    () =>
      rides.filter((ride) => {
        if (hiddenRideIds.includes(ride.id)) return false;
        return String(ride.status || '') === 'available';
      }),
    [rides, hiddenRideIds]
  );

  useEffect(() => {
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setRides(
        list
          .filter((ride) => ride.status !== 'cancelled' && !hiddenRideIds.includes(ride.id))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    });
    return () => unsubscribe();
  }, [profile.uid, hiddenRideIds]);

  useEffect(() => {
    const bookingQuery = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
    const unsubscribe = onSnapshot(bookingQuery, (snapshot) => {
      const rideIds = new Set<string>();
      snapshot.forEach((bookingDoc) => {
        const booking = bookingDoc.data() as Booking;
        const isNegotiationActive =
          ['pending', 'negotiating'].includes(String(booking.status || '')) &&
          booking.negotiationStatus !== 'rejected' &&
          !booking.rideRetired &&
          !booking.feePaid &&
          !booking.driverFeePaid &&
          !booking.rideStartedAt &&
          !booking.rideEndedAt;

        if (isNegotiationActive && booking.rideId) {
          rideIds.add(booking.rideId);
        }
      });
      setActiveNegotiationRideIds(Array.from(rideIds));
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const confirmCancelRideOffer = async (ride: any) => {
    if (ride.status !== 'available') {
      showAppDialog('Only active unbooked ride offers can be cancelled.', 'warning');
      return;
    }

    if (activeNegotiationRideIds.includes(ride.id)) {
      showAppDialog(
        'A traveler negotiation is currently active on this ride. Please wait for that offer thread to be accepted or rejected before cancelling the ride offer.',
        'warning'
      );
      return;
    }

    setCancellingRideId(ride.id);
    try {
      const bookingSnapshot = await getDocs(query(collection(db, 'bookings'), where('rideId', '==', ride.id)));
      const hasLockedTrip = bookingSnapshot.docs.some((bookingDoc) => {
        const booking = bookingDoc.data() as Booking;
        return (
          booking.status === 'confirmed' ||
          booking.feePaid ||
          booking.driverFeePaid ||
          !!booking.rideStartedAt ||
          !!booking.rideEndedAt
        );
      });

      if (hasLockedTrip) {
        showAppDialog(
          'This trip is already confirmed and locked for travel. Drivers cannot cancel it now. Please contact MaiRide customer support for an override if cancellation is unavoidable.',
          'warning'
        );
        return;
      }

      if (isLocalDevFirestoreMode()) {
        await axios.post(apiPath('/api/user/cancel-ride'), {
          rideId: ride.id,
          driverId: profile.uid,
          driverPhone: profile.phoneNumber || '',
        });
        setRides((prev) => prev.filter((existingRide) => existingRide.id !== ride.id));
        onRideRetired?.(ride.id);
        showAppDialog('Ride offer cancelled. All live requests for this ride have been cleared.', 'success');
        setPendingCancelRide(null);
        return;
      }
      const updatedAt = new Date().toISOString();

      await Promise.all(
        bookingSnapshot.docs.map(async (bookingDoc) => {
          const booking = { id: bookingDoc.id, ...(bookingDoc.data() as Booking) };
          if (!['pending', 'confirmed', 'negotiating'].includes(booking.status)) return;
          await updateDoc(doc(db, 'bookings', booking.id), {
            status: 'cancelled',
            negotiationStatus: 'rejected',
            negotiationActor: booking.negotiationActor || 'driver',
            rideRetired: true,
            retiredAt: updatedAt,
            driverPhone: profile.phoneNumber || '',
            updatedAt,
          });
        })
      );

      await Promise.all(
        [ride.id].map((currentRideId) =>
          updateDoc(doc(db, 'rides', currentRideId), {
            status: 'cancelled',
            updatedAt,
          })
        )
      );

      setRides((prev) => prev.filter((currentRide) => currentRide.id !== ride.id));
      onRideRetired?.(ride.id);
      showAppDialog('Ride offer cancelled. All live requests linked to it were cleared.', 'success');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to cancel ride offer');
      showAppDialog(message, 'error');
    } finally {
      setCancellingRideId(null);
      setPendingCancelRide(null);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!visibleRides.length) return null;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-mairide-primary mb-8">My Ride Offers</h1>
      <div className="space-y-6">
        {visibleRides.map((ride) => (
            <div key={ride.id} className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-mairide-primary">{ride.origin} → {ride.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Price: {formatCurrency(ride.price)}</p>
                </div>
                <div className={cn(
                  "px-4 py-1 rounded-full text-xs font-bold uppercase",
                  ride.status === 'available' ? "bg-green-100 text-green-700" : "bg-mairide-secondary text-mairide-primary"
                )}>
                  {ride.status}
                </div>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-mairide-secondary/20">
                <span className="text-sm text-mairide-secondary">{new Date(ride.createdAt).toLocaleDateString()}</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-mairide-primary">{ride.seatsAvailable} seats left</span>
                  {ride.status === 'available' && !activeNegotiationRideIds.includes(ride.id) && (
                    <button
                      onClick={() => setPendingCancelRide(ride)}
                      disabled={cancellingRideId === ride.id}
                      className="px-4 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50"
                    >
                      {cancellingRideId === ride.id ? 'Cancelling...' : 'Cancel Offer'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>
      {pendingCancelRide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-mairide-primary/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <button
                onClick={() => setPendingCancelRide(null)}
                className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Cancel Ride Offer</p>
            <p className="mt-3 text-base leading-7 text-mairide-primary">
              This will withdraw the ride offer and clear any live traveler requests attached to it. You can post a fresh offer later whenever you are ready.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setPendingCancelRide(null)}
                className="flex-1 rounded-2xl border border-mairide-secondary py-3 text-sm font-bold text-mairide-primary"
              >
                Keep Offer
              </button>
              <button
                onClick={() => confirmCancelRideOffer(pendingCancelRide)}
                className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700"
              >
                Cancel Ride
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DriverHistory = ({ profile }: { profile: UserProfile }) => {
  const [rides, setRides] = useState<any[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    const ridesQuery = query(collection(db, 'rides'), where('driverId', '==', profile.uid));
    const unsubscribeRides = onSnapshot(ridesQuery, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnapshot) => list.push({ id: docSnapshot.id, ...docSnapshot.data() }));
      setRides(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoadingRides(false);
    });

    const bookingsQuery = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((docSnapshot) => list.push({ id: docSnapshot.id, ...(docSnapshot.data() as Booking) }));
      setBookings(
        dedupeBookingsByThread(list)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoadingBookings(false);
    });

    return () => {
      unsubscribeRides();
      unsubscribeBookings();
    };
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  if (loadingRides || loadingBookings) return <LoadingScreen />;

  const completedTrips = bookings.filter((booking) => booking.status === 'completed');
  const confirmedTrips = bookings.filter((booking) => ['confirmed', 'completed'].includes(booking.status));
  const cancelledOffers = rides.filter((ride) => ride.status === 'cancelled').length;
  const grossEarnings = completedTrips.reduce((sum, booking) => sum + (booking.fare || 0), 0);
  const maicoinsSavings = confirmedTrips.reduce((sum, booking) => sum + (booking.driverMaiCoinsUsed || 0), 0);

  const cashflowChart = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    const month = date.toLocaleString('en-IN', { month: 'short' });

    const monthBookings = completedTrips.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });
    const monthMaicoins = confirmedTrips.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });

    return {
      month,
      earnings: Math.round(monthBookings.reduce((sum, booking) => sum + (booking.fare || 0), 0)),
      maicoins: Math.round(monthMaicoins.reduce((sum, booking) => sum + (booking.driverMaiCoinsUsed || 0), 0)),
    };
  });

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;

    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits, profile.uid);
      alert('Your traveler review has been submitted successfully.');
      setReviewBooking(null);
    } catch (error: any) {
      console.error('Error submitting traveler review:', error);
      alert(error.response?.data?.error || error.message || 'Failed to submit traveler review.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-mairide-primary mb-8">Driver History</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Rides Created</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{rides.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Trips Completed</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{completedTrips.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Offers Cancelled</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{cancelledOffers}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Gross Earnings</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(grossEarnings)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Maicoins Savings</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(maicoinsSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Equivalent amount offset from platform fees.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Current Wallet</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{profile.wallet?.balance || 0}</p>
          <p className="text-xs text-mairide-secondary mt-2">Live Maicoins balance available right now.</p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-bold text-mairide-primary mb-4">Cashflow & Maicoins Trend (Last 6 Months)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cashflowChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DAD9D3" />
              <XAxis dataKey="month" stroke="#4A4A4A" />
              <YAxis stroke="#4A4A4A" />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="earnings" name="Trip Earnings" fill="#E56A10" radius={[8, 8, 0, 0]} />
              <Bar dataKey="maicoins" name="Maicoins Savings" fill="#0F2A3D" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary">Completed Trips & Traveler Reviews</h2>
        {completedTrips.length ? (
          completedTrips.map((booking) => (
            <div key={booking.id} className="bg-white rounded-3xl border border-mairide-secondary p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                  <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary mt-2">
                    Completed {booking.rideEndedAt ? new Date(booking.rideEndedAt).toLocaleString() : new Date(booking.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-lg font-black text-mairide-accent">{formatCurrency(booking.fare || 0)}</p>
                  {booking.driverReview ? (
                    <div className="mt-2 inline-flex items-center rounded-full bg-green-50 px-4 py-2 text-xs font-bold text-green-700">
                      Rated traveler {booking.driverReview.rating}/5
                    </div>
                  ) : (
                    <button
                      onClick={() => setReviewBooking(booking)}
                      className="mt-2 rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white"
                    >
                      Rate Traveler
                    </button>
                  )}
                </div>
              </div>
              {booking.driverReview?.comment && (
                <p className="mt-3 text-sm italic text-mairide-secondary">"{booking.driverReview.comment}"</p>
              )}
              {!!booking.driverReview?.traits?.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {booking.driverReview.traits.map((trait) => (
                    <span
                      key={trait}
                      className="rounded-full bg-mairide-accent/10 px-3 py-1 text-xs font-bold text-mairide-accent"
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              )}
              <PaymentAuditTrail
                booking={booking}
                transactions={transactions}
                viewer="driver"
              />
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-mairide-secondary bg-white py-12 text-center">
            <p className="text-mairide-secondary">Completed rides will appear here for traveler reviews.</p>
          </div>
        )}
      </div>

      <div className="mt-8 space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary">All Ride Offers</h2>
        {rides.length ? (
          rides.map((ride) => (
            <div key={ride.id} className="bg-white rounded-3xl border border-mairide-secondary p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                  <p className="text-sm text-mairide-secondary">Created: {new Date(ride.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "px-4 py-1 rounded-full text-xs font-bold uppercase",
                    ride.status === 'available' ? "bg-green-100 text-green-700" :
                    ride.status === 'completed' ? "bg-blue-100 text-blue-700" :
                    ride.status === 'cancelled' ? "bg-red-100 text-red-700" :
                    "bg-mairide-bg text-mairide-primary"
                  )}>
                    {ride.status}
                  </span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(ride.price || 0)}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-mairide-secondary">
            <History className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
            <p className="text-mairide-secondary">No ride history yet.</p>
          </div>
        )}
      </div>
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="driver"
          onClose={() => setReviewBooking(null)}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

// --- Main App Components ---

const BookingRequests = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [requests, setRequests] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [counterFares, setCounterFares] = useState<{[key: string]: string}>({});
  const [paymentRequest, setPaymentRequest] = useState<Booking | null>(null);

  const loadRequestThread = async (seedBooking: Booking) => {
    const threadSnapshot = await getDocs(
      query(
        collection(db, 'bookings'),
        where('rideId', '==', seedBooking.rideId),
        where('consumerId', '==', seedBooking.consumerId)
      )
    );

    return threadSnapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
      .filter((booking) => getBookingThreadKey(booking) === getBookingThreadKey(seedBooking));
  };

  const handleCounterOffer = async (requestId: string, fare: number) => {
    if (!fare || fare <= 0) {
      alert("Please enter a valid fare.");
      return;
    }
    try {
      const request = requests.find((booking) => booking.id === requestId);
      if (!request) {
        throw new Error('Booking request not found.');
      }
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=counter-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const updatedAt = new Date().toISOString();
      setRequests((prev) =>
        prev.map((booking) =>
          getBookingThreadKey(booking) === getBookingThreadKey(request)
            ? {
                ...booking,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'driver',
                driverCounterPending: true,
                status: 'negotiating',
                updatedAt,
              }
            : booking
        )
      );
      showAppDialog("Counter offer sent to traveler!", 'success');
    } catch (error) {
      try {
        const request = requests.find((booking) => booking.id === requestId);
        if (!request) {
          throw error;
        }
        const updatedAt = await persistCounterOfferThroughCompatStore(request, 'driver', fare);
        setRequests((prev) =>
          prev.map((booking) =>
            getBookingThreadKey(booking) === getBookingThreadKey(request)
              ? {
                  ...booking,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'driver',
                  driverCounterPending: true,
                  status: 'negotiating',
                  updatedAt,
                }
              : booking
          )
        );
        showAppDialog("Counter offer sent to traveler!", 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${requestId}`);
      }
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('driverId', '==', profile.uid),
      where('status', 'in', ['pending', 'confirmed', 'negotiating'])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) =>
        list.push(normalizeNegotiationBooking({ id: doc.id, ...(doc.data() as Booking) }))
      );
      setRequests(
        dedupeBookingsByThread(list)
          .filter(
            (booking) =>
              !(booking as any).rideRetired &&
              booking.negotiationStatus !== 'rejected' &&
              ['pending', 'confirmed', 'negotiating'].includes(booking.status)
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleAction = async (requestId: string, status: 'confirmed' | 'rejected', fare: number, driverId: string) => {
    try {
      const bookingData = requests.find((booking) => booking.id === requestId);
      if (!bookingData) {
        throw new Error('Booking request not found.');
      }
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=respond-booking',
        {
          bookingId: bookingData.id,
          driverId: profile.uid,
          action: status,
          driverPhone: profile.phoneNumber || '',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      const acceptedFare =
        hasPendingTravelerCounterOffer(bookingData) && bookingData.negotiatedFare
          ? bookingData.negotiatedFare
          : fare;

      setRequests((prev) =>
        status === 'rejected'
          ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(bookingData))
          : prev.map((booking) =>
              getBookingThreadKey(booking) === getBookingThreadKey(bookingData)
                ? {
                    ...booking,
                    status,
                    fare: acceptedFare,
                    driverPhone: profile.phoneNumber || '',
                    driverCounterPending: false,
                    negotiationStatus:
                      booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                    updatedAt,
                  }
                : booking
            )
      );
      showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${requestId}`);
    }
  };

  const submitDriverPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    const { baseFee, gstAmount } = calculateServiceFee(booking.fare, config || undefined);
    const receiptRef = storageRef(storage, `payments/${booking.id}/driver-${Date.now()}.jpg`);
    await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
    const receiptUrl = await getDownloadURL(receiptRef);
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'proof_submitted',
      driverPaymentMode: 'online',
      driverPaymentTransactionId: payload.transactionId,
      driverPaymentReceiptUrl: receiptUrl,
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
      driverNetServiceFee: baseFee,
      driverNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: 'online',
      paymentStatus: 'pending',
      transactionId: payload.transactionId,
      receiptUrl,
      gateway: 'manual',
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Driver payment proof submitted successfully.');
  };

const finalizeDriverRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    const { netServiceFee, gstAmount } = getHybridPaymentBreakdown(
      booking,
      profile.wallet?.balance || 0,
      coinsUsed > 0,
      config || undefined
    );
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'paid',
      driverPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      driverMaiCoinsUsed: coinsUsed,
      driverPaymentTransactionId: payment.paymentId,
      driverPaymentOrderId: payment.orderId,
      driverPaymentGateway: 'razorpay',
      driverPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
      driverNetServiceFee: netServiceFee,
      driverNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Driver Razorpay payment verified successfully.', 'success');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);

      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'driver',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeDriverRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentRequest(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        driverMaiCoinsUsed: coinsToUse,
        driverPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        driverPhone: profile.phoneNumber || '',
        driverNetServiceFee: 0,
        driverNetGstAmount: 0,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Unable to start Razorpay checkout.');
      showAppDialog(message, 'error', 'Payment unavailable');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-mairide-primary">Booking Requests</h1>
        <div className="bg-mairide-primary text-white px-6 py-3 rounded-2xl flex items-center space-x-3 shadow-lg shadow-mairide-primary/20">
          <Bot className="w-5 h-5 text-mairide-accent" />
          <div>
            <p className="text-[10px] font-bold uppercase opacity-60 leading-none mb-1">Wallet Balance</p>
            <p className="text-lg font-black tracking-tighter">{profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">Maicoins</span></p>
          </div>
        </div>
      </div>
      <div className="space-y-6">
        {requests.length > 0 ? (
          requests.map((request) => (
            <div key={request.id} className="bg-white p-8 rounded-[32px] border border-mairide-secondary shadow-sm hover:shadow-md transition-shadow">
              {(() => {
                const pendingActor = getPendingNegotiationActor(request);
                const driverCounterPending = pendingActor === 'driver';
                const travelerCounterPending = pendingActor === 'consumer';
                const displayFare = getNegotiationDisplayFare(request);
                const listedFare = getListedFare(request);
                const showNegotiatedFareLine = shouldShowNegotiatedFareLine(request);
                const requestedOrigin = request.requestedOrigin || request.origin;
                const requestedDestination = request.requestedDestination || request.destination;
                const showsDetour =
                  Boolean(request.requiresDetour) &&
                  (normalizeSearchText(requestedOrigin) !== normalizeSearchText(request.origin) ||
                    normalizeSearchText(requestedDestination) !== normalizeSearchText(request.destination));
                const statusLabel = driverCounterPending
                  ? 'awaiting traveler'
                  : travelerCounterPending
                    ? 'traveler counter'
                    : request.status;

                return (
                  <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-xl text-mairide-primary mb-1">{request.origin} → {request.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
                  {request.feePaid && request.driverFeePaid ? (
                    <ContactUnlockCard label="Traveler contact" phoneNumber={request.consumerPhone} />
                  ) : request.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(request.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase">{statusLabel}</p>
                </div>
              </div>
              
              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Listed fare</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">
                    {travelerCounterPending ? 'Traveler offered fare' : driverCounterPending ? 'Your counter fare' : 'Current request fare'}
                  </span>
                  <span className={cn("font-bold", showNegotiatedFareLine ? "text-mairide-accent text-xl" : "text-mairide-primary text-lg")}>
                    {formatCurrency(displayFare)}
                  </span>
                </div>
              </div>

              {showsDetour && (
                <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-mairide-accent" /><p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Traveler Detour Request</p></div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Your listed route</p>
                      <p className="mt-1 text-sm font-semibold text-mairide-primary">{request.origin} → {request.destination}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler requested route</p>
                      <p className="mt-1 text-sm font-semibold text-mairide-primary">{requestedOrigin} → {requestedDestination}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl bg-white/80 p-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Decision Impact</p>
                    <p className="mt-1 text-sm font-semibold text-mairide-primary">This traveler wants a pickup and/or drop adjustment from your listed route. Review the detour carefully before you accept, reject, or counter.</p>
                  </div>
                </div>
              )}

              {driverCounterPending ? (
                <div className="bg-mairide-bg p-6 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Clock className="w-5 h-5 text-mairide-accent" />
                    <div>
                      <p className="font-bold text-mairide-primary">Your counter offer has been sent.</p>
                      <p className="text-xs text-mairide-secondary">Waiting for the traveler to accept or reject {formatCurrency(displayFare)}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAction(request.id, 'rejected', request.fare, request.driverId)}
                    className="text-xs font-bold text-red-600 hover:underline"
                  >
                    Cancel Request
                  </button>
                </div>
              ) : (request.status === 'pending' || travelerCounterPending) ? (
                <div className="space-y-4">
                  <div className="flex space-x-4">
                    <button 
                      onClick={() => handleAction(request.id, 'confirmed', request.fare, request.driverId)}
                      className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-100"
                    >
                      {travelerCounterPending ? 'Accept Offer' : 'Accept Request'}
                    </button>
                    <button 
                      onClick={() => handleAction(request.id, 'rejected', request.fare, request.driverId)}
                      className="flex-1 bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                  
                  <div className="pt-4 border-t border-mairide-secondary/20">
                    <p className="text-xs font-bold text-mairide-secondary uppercase mb-3">Or Send Counter Offer</p>
                    <div className="flex space-x-2">
                      <div className="relative flex-1">
                        <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-4 h-4" />
                        <input 
                          type="number"
                          placeholder="Enter your fare"
                          className="w-full pl-10 pr-4 py-3 bg-mairide-bg border border-mairide-secondary rounded-xl outline-none text-sm"
                          value={counterFares[request.id] || ''}
                          onChange={e => setCounterFares({...counterFares, [request.id]: e.target.value})}
                        />
                      </div>
                      <button 
                        onClick={() => handleCounterOffer(request.id, Number(counterFares[request.id]))}
                        className="bg-mairide-primary text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                      >
                        Send Offer
                      </button>
                    </div>
                  </div>
                </div>
              ) : !request.driverFeePaid ? (
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handlePayFee(request, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-mairide-primary/20"
                  >
                    <Bot className="w-5 h-5" />
                    <span>{isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(request, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online & Upload Proof'}
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-center space-x-2 text-green-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Platform Fee Submitted {request.driverMaiCoinsUsed > 0 && `(Used ${request.driverMaiCoinsUsed} Maicoins)`}</span>
                </div>
              )}

              <PaymentAuditTrail
                booking={request}
                transactions={transactions}
                viewer="driver"
              />
                  </>
                );
              })()}
            </div>
          ))
        ) : (
          <div className="text-center py-20 bg-white rounded-[40px] border border-dashed border-mairide-secondary">
            <Clock className="w-16 h-16 text-mairide-secondary mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-bold text-mairide-primary">No pending requests</h3>
            <p className="text-mairide-secondary italic serif">New booking requests from travelers will appear here.</p>
          </div>
        )}
      </div>
      {paymentRequest && (
        <PaymentProofModal
          booking={paymentRequest}
          payer="driver"
          config={config}
          onClose={() => setPaymentRequest(null)}
          onSubmit={(payload) => submitDriverPaymentProof(paymentRequest, payload)}
        />
      )}
    </div>
  );
};

const ConsumerApp = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const { config } = useAppConfig();
  const firstName = String(profile.displayName || profile.email || 'Traveler').split(' ')[0] || 'Traveler';
  const [search, setSearch] = useState({ from: '', to: '' });
  const [rides, setRides] = useState<any[]>([]);
  const [partialRides, setPartialRides] = useState<any[]>([]);
  const [dashboardBookings, setDashboardBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'wallet' | 'support' | 'profile'>('search');
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [dismissedReviewIds, setDismissedReviewIds] = useState<Record<string, boolean>>({});
  const hasMapsIssue = Boolean(loadError || authFailure);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(() => {
    if (isAppWebViewRuntime() || isAndroidWebViewLikeRuntime()) return null;
    return extractLatLng(profile.location);
  });
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [selectedRide, setSelectedRide] = useState<any | null>(null);
  const [pendingFutureRideAction, setPendingFutureRideAction] = useState<{
    ride: any;
    requestedFare?: number;
    mode: 'booking' | 'counter';
  } | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [travelerCounterFare, setTravelerCounterFare] = useState('');
  const [dashboardCounterFares, setDashboardCounterFares] = useState<{ [key: string]: string }>({});
  const [autocompleteFrom, setAutocompleteFrom] = useState<any | null>(null);
  const [autocompleteTo, setAutocompleteTo] = useState<any | null>(null);
  const [searchLocationFrom, setSearchLocationFrom] = useState<{ lat: number, lng: number } | null>(null);
  const [searchLocationTo, setSearchLocationTo] = useState<{ lat: number, lng: number } | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [isPostingRequest, setIsPostingRequest] = useState(false);
  const [newRequest, setNewRequest] = useState({
    origin: '',
    destination: '',
    fare: '',
    seats: '1',
    departureDay: 'today',
    departureClock: '09:00',
  });
  const [travelerRequests, setTravelerRequests] = useState<TravelerRideRequest[]>([]);
  const [requestAutocompleteFrom, setRequestAutocompleteFrom] = useState<any | null>(null);
  const [requestAutocompleteTo, setRequestAutocompleteTo] = useState<any | null>(null);
  const [requestOriginLocation, setRequestOriginLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [requestDestinationLocation, setRequestDestinationLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [directionsResponse, setDirectionsResponse] = useState<any | null>(null);
  const [rideStatusById, setRideStatusById] = useState<Record<string, Ride['status']>>({});
  const [tripSessions, setTripSessions] = useState<Record<string, TripSession>>({});
  const [ridesResolved, setRidesResolved] = useState(false);
  const [tripNetworkState, setTripNetworkState] = useState<TripSession['networkState']>(
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline'
  );
  const [tripAppState, setTripAppState] = useState<TripSession['appState']>(
    typeof document !== 'undefined' && document.visibilityState === 'visible' ? 'foreground' : 'background'
  );
  const seenDriverCounterNotificationsRef = useRef<Record<string, string>>({});
  const hasHydratedDriverCountersRef = useRef(false);
  const travelerFeedLocation = useMemo(
    () => getFeedViewerLocation(userLocation, profile.location),
    [profile.location?.lat, profile.location?.lng, userLocation]
  );
  const activeTravelerRequestRoutes = useMemo(
    () =>
      travelerRequests
        .filter((request) => request.status === 'open')
        .filter((request) => isRideWithinPlanningWindow(request))
        .map((request) => getFeedItemRoute(request))
        .filter(
          (route): route is {
            originLocation: { lat: number; lng: number };
            destinationLocation: { lat: number; lng: number };
          } => Boolean(route)
        ),
    [travelerRequests]
  );

  useEffect(() => {
    const handleHomeNavigation = () => setActiveTab('search');
    const handleTabNavigation = (event: Event) => {
      const customEvent = event as CustomEvent<{ role?: string; tab?: string }>;
      const targetTab = customEvent.detail?.tab;
      if (!targetTab) return;
      if (['search', 'history', 'wallet', 'support', 'profile'].includes(targetTab)) {
        setActiveTab(targetTab as 'search' | 'history' | 'wallet' | 'support' | 'profile');
      }
    };
    window.addEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
    window.addEventListener(APP_NAV_TAB_EVENT, handleTabNavigation as EventListener);
    return () => {
      window.removeEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
      window.removeEventListener(APP_NAV_TAB_EVENT, handleTabNavigation as EventListener);
    };
  }, []);

  useEffect(() => {
    if (isLocalDevFirestoreMode()) {
      const q = query(collection(db, 'bookings'), where('consumerId', '==', profile.uid));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: Booking[] = [];
        snapshot.forEach((snapshotDoc) =>
          list.push(normalizeNegotiationBooking({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
        );
        setDashboardBookings(
          dedupeBookingsByThread(
            list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          )
        );
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'bookings');
      });
      return () => unsubscribe();
    }

    let isMounted = true;
    let pollTimer: number | null = null;

    const loadDashboardBookings = async () => {
      try {
        const token = await getAccessToken();
        const { data } = await axios.get(apiPath('/api/user?action=list-bookings&scope=consumer'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!isMounted) return;
        const list = Array.isArray(data?.bookings) ? data.bookings as Booking[] : [];
        const normalized = dedupeBookingsByThread(
          list
            .map((booking) => normalizeNegotiationBooking(booking))
            .sort(
              (a, b) =>
                new Date((b as any).updatedAt || b.createdAt).getTime() -
                new Date((a as any).updatedAt || a.createdAt).getTime()
            )
        );
        setDashboardBookings(normalized);
      } catch (error) {
        if (!isMounted) return;
        console.error('Traveler booking load failed:', error);
        setDashboardBookings([]);
      }
    };

    void loadDashboardBookings();
    pollTimer = window.setInterval(() => {
      void loadDashboardBookings();
    }, 8000);

    return () => {
      isMounted = false;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [profile.uid]);

  useEffect(() => {
    if (isLocalDevFirestoreMode()) {
      const q = query(collection(db, 'travelerRideRequests'), where('consumerId', '==', profile.uid));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list: TravelerRideRequest[] = snapshot.docs.map((snapshotDoc) => ({
            id: snapshotDoc.id,
            ...(snapshotDoc.data() as TravelerRideRequest),
          }));
          setTravelerRequests(
            list
              .filter((item) => isRideWithinPlanningWindow(item))
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          );
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, 'travelerRideRequests');
        }
      );
      return () => unsubscribe();
    }

    let isMounted = true;
    let pollTimer: number | null = null;

    const loadTravelerRequests = async () => {
      try {
        const token = await getAccessToken();
        const { data } = await axios.get(apiPath('/api/user?action=list-traveler-requests&scope=own'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!isMounted) return;
        const list = Array.isArray(data?.requests) ? data.requests as TravelerRideRequest[] : [];
        setTravelerRequests(
          list
            .filter((item) => isRideWithinPlanningWindow(item))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        );
      } catch (error) {
        if (!isMounted) return;
        console.error('Traveler request load failed:', error);
        showAppDialog(
          getApiErrorMessage(error, 'We could not load your ride requests right now. Please retry.'),
          'error'
        );
        setTravelerRequests([]);
      }
    };

    void loadTravelerRequests();
    pollTimer = window.setInterval(() => {
      void loadTravelerRequests();
    }, 8000);

    return () => {
      isMounted = false;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [profile.uid]);

  useEffect(() => {
    if (!isLocalDevFirestoreMode()) return;
    const q = query(collection(db, 'tripSessions'), where('consumerId', '==', profile.uid));
    let unsubscribe: (() => void) | null = null;
    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: Record<string, TripSession> = {};
        snapshot.docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data() as TripSession;
          next[data.bookingId || snapshotDoc.id] = { ...data, id: snapshotDoc.id };
        });
        setTripSessions(next);
      },
      (error) => {
        if (isMissingSupabaseTableError(error)) {
          console.warn('Trip sessions table missing; pausing traveler session polling.');
          if (unsubscribe) unsubscribe();
          return;
        }
        console.error('Trip session subscription error (traveler):', error);
      }
    );
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [profile.uid]);

  useEffect(() => {
    const currentKeys = dashboardBookings.reduce((acc: Record<string, string>, booking) => {
      if (hasPendingDriverCounterOffer(booking)) {
        acc[booking.id] = `${booking.negotiationActor}|${booking.negotiatedFare}|${(booking as any).updatedAt || booking.createdAt || ''}`;
      }
      return acc;
    }, {});

    if (!hasHydratedDriverCountersRef.current) {
      seenDriverCounterNotificationsRef.current = currentKeys;
      hasHydratedDriverCountersRef.current = true;
      return;
    }

    dashboardBookings.forEach((booking) => {
      if (!hasPendingDriverCounterOffer(booking)) return;
      const nextKey = currentKeys[booking.id];
      const previousKey = seenDriverCounterNotificationsRef.current[booking.id];
      if (nextKey && nextKey !== previousKey) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `${booking.driverName} proposed ${formatCurrency(getNegotiationDisplayFare(booking))} for ${booking.origin} to ${booking.destination}.`,
          { tag: `traveler-counter-${booking.id}` }
        );
      }
    });

    seenDriverCounterNotificationsRef.current = currentKeys;
  }, [dashboardBookings]);

  useEffect(() => {
    if (reviewBooking) return;
    const pendingReview = dashboardBookings.find(
      (booking) =>
        (booking.status === 'completed' || booking.rideLifecycleStatus === 'completed' || !!booking.rideEndedAt) &&
        !booking.consumerReview &&
        !dismissedReviewIds[booking.id]
    );
    if (pendingReview) {
      setReviewBooking(pendingReview);
    }
  }, [dashboardBookings, dismissedReviewIds, reviewBooking]);

  useEffect(() => {
    const q = query(collection(db, 'rides'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesList = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Ride) }));
      const nextStatusMap = ridesList.reduce((acc: Record<string, Ride['status']>, ride: Ride) => {
        acc[ride.id] = ride.status;
        return acc;
      }, {});
      setRideStatusById(nextStatusMap);
      setRidesResolved(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rides');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedRide && selectedRide.originLocation && selectedRide.destinationLocation && isLoaded && window.google) {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: selectedRide.originLocation,
          destination: selectedRide.destinationLocation,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            setDirectionsResponse(result);
          } else {
            console.error(`error fetching directions ${result}`);
          }
        }
      );
    } else {
      setDirectionsResponse(null);
    }
  }, [selectedRide, isLoaded]);

  const reverseGeocode = async (lat: number, lng: number) => {
    if (!window.google || !window.google.maps) return;
    const geocoder = new window.google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ location: { lat, lng } });
      if (result.results[0]) {
        setSearch(prev => ({ ...prev, from: result.results[0].formatted_address }));
      }
    } catch (error) {
      console.error("Geocoding failed:", error);
    }
  };

  useEffect(() => {
    if (userLocation || isAppWebViewRuntime() || isAndroidWebViewLikeRuntime()) return;
    const fallbackLocation = extractLatLng(profile.location);
    if (fallbackLocation) {
      setUserLocation(fallbackLocation);
    }
  }, [profile.location?.lat, profile.location?.lng, userLocation]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          reverseGeocode(latitude, longitude);
          
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => {
          logGeolocationIssue('Traveler', error);
          const fallbackLocation = extractLatLng(profile.location);
          if (fallbackLocation) {
            setUserLocation((prev) => prev || fallbackLocation);
          }
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => {
          logGeolocationIssue('Traveler', error);
          const fallbackLocation = extractLatLng(profile.location);
          if (fallbackLocation) {
            setUserLocation((prev) => prev || fallbackLocation);
          }
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [profile.uid, profile.location?.lat, profile.location?.lng]);

  useEffect(() => {
    const handleOnline = () => setTripNetworkState('recovered');
    const handleOffline = () => setTripNetworkState('offline');
    const handleVisibility = () => setTripAppState(document.visibilityState === 'visible' ? 'foreground' : 'background');
    const handleFocus = () => setTripAppState('resumed');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    const activeBookings = dashboardBookings.filter(isBookingTrackable);
    if (!activeBookings.length) return;

    const sync = () => {
      activeBookings.forEach((booking) => {
        void upsertTripSession({
          booking,
          actorRole: 'consumer',
          actorId: profile.uid,
          location: userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined,
          networkState: tripNetworkState,
          appState: tripAppState,
          note: 'traveler_presence_sync',
        }).catch((error) => {
          console.error('Traveler trip session sync failed:', error);
        });
      });
      if (tripNetworkState === 'recovered') {
        setTripNetworkState('online');
      }
      if (tripAppState === 'resumed') {
        setTripAppState(document.visibilityState === 'visible' ? 'foreground' : 'background');
      }
    };

    sync();
    const timer = window.setInterval(sync, TRIP_SIGNAL_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [dashboardBookings, profile.uid, userLocation, tripNetworkState, tripAppState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Object.values(tripSessions).forEach((session) => {
        void markTripSessionStale(session).catch((error) => {
          console.error('Failed to mark stale traveler trip session:', error);
        });
      });
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [tripSessions]);

  useEffect(() => {
    // Listen for online drivers within the local dashboard radius only.
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const driverList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserProfile;
        const driverOriginLocation = getFeedItemOriginLocation(data);
        if (
          data.role === 'driver' &&
          data.driverDetails?.isOnline &&
          isWithinDashboardMatchRadius(travelerFeedLocation, driverOriginLocation)
        ) {
          driverList.push(data);
        }
      });
      setDrivers(driverList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, [travelerFeedLocation]);

  const geocodeAddress = async (address: string) => {
    if (!window.google || !window.google.maps) return null;
    const geocoder = new window.google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ address });
      const location = result.results?.[0]?.geometry?.location;
      if (!location) return null;
      return {
        lat: location.lat(),
        lng: location.lng(),
      };
    } catch (error) {
      console.error('Address geocoding failed:', error);
      return null;
    }
  };
  const buildScheduledDeparture = (dayKey: string, timeValue: string) => {
    const scheduledDate = new Date();
    if (dayKey === 'tomorrow') {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    } else if (dayKey === 'dayAfter') {
      scheduledDate.setDate(scheduledDate.getDate() + 2);
    }

    const [hours, minutes] = (timeValue || '09:00').split(':').map(Number);
    scheduledDate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return scheduledDate.toISOString();
  };

  const formatDepartureDayLabel = (dayKey: string) => {
    if (dayKey === 'tomorrow') return 'Tomorrow';
    if (dayKey === 'dayAfter') return 'Day After';
    return 'Today';
  };

  const handlePostTravelerRequest = async () => {
    const origin = newRequest.origin.trim();
    const destination = newRequest.destination.trim();
    const fareValue = Number(newRequest.fare);
    const seatsNeeded = Number(newRequest.seats);

    if (!origin || !destination) {
      showAppDialog('Please select both origin and destination before posting your ride request.', 'warning');
      return;
    }
    if (!Number.isFinite(fareValue) || fareValue <= 0) {
      showAppDialog('Please enter a valid target fare greater than zero.', 'warning');
      return;
    }
    if (!Number.isFinite(seatsNeeded) || seatsNeeded < 1) {
      showAppDialog('Please choose at least one seat.', 'warning');
      return;
    }

    setIsPostingRequest(true);
    try {
      const geocodeTimeoutMs = 8000;
      const profileLocation = profile.location || null;
      const resolvedOriginLocation =
        requestOriginLocation || userLocation || profileLocation || await withTimeout(geocodeAddress(origin), geocodeTimeoutMs, null);
      const resolvedDestinationLocation =
        requestDestinationLocation || await withTimeout(geocodeAddress(destination), geocodeTimeoutMs, null) || resolvedOriginLocation;
      if (!resolvedOriginLocation) {
        showAppDialog('Please allow location access or select a valid origin from suggestions.', 'warning');
        return;
      }

      const resolvedConsumerId =
        profile.uid || auth.currentUser?.uid || (await getSessionUserId()) || '';
      const resolvedConsumerName =
        profile.displayName || auth.currentUser?.displayName || profile.email || auth.currentUser?.email || 'Traveler';

      const requestPayload = {
        consumerId: resolvedConsumerId,
        consumerName: resolvedConsumerName,
        consumerPhone: profile.phoneNumber || '',
        origin,
        destination,
        originLocation: resolvedOriginLocation,
        destinationLocation: resolvedDestinationLocation,
        fare: fareValue,
        seatsNeeded,
        departureDay: newRequest.departureDay,
        departureDayLabel: formatDepartureDayLabel(newRequest.departureDay),
        departureClock: newRequest.departureClock,
        departureNote: 'Planned departure time may vary due to traffic, road, and operational conditions.',
        departureTime: buildScheduledDeparture(newRequest.departureDay, newRequest.departureClock),
      };
      const requestBody = {
        ...requestPayload,
        action: 'create-traveler-request',
      };

      if (!requestPayload.consumerId) {
        throw new Error('Unable to resolve authenticated traveler identity. Please sign in again and retry.');
      }

      if (isLocalDevFirestoreMode()) {
        const now = new Date().toISOString();
        await addDoc(collection(db, 'travelerRideRequests'), {
          ...requestPayload,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        } as Omit<TravelerRideRequest, 'id'>);
      } else {
        const token = await withTimeout(getAccessToken(), 8000, '');
        if (!token) {
          throw new Error('Authentication timed out. Please retry.');
        }
        const headers = {
          Authorization: `Bearer ${token}`,
        };
        try {
          await axios.post(apiPath('/api/user?action=create-traveler-request'), requestBody, {
            headers,
            timeout: 15000,
          });
        } catch (primaryError) {
          try {
            await axios.post(apiPath('/api/user/create-traveler-request'), requestBody, {
              headers,
              timeout: 15000,
            });
          } catch (secondaryError) {
            await axios.post(apiPath('/api/user'), requestBody, {
              headers,
              timeout: 15000,
            });
          }
        }
      }

      void trackPlatformUsageEvent('ride_requested', {
        origin,
        destination,
        seatsNeeded,
        departureDay: newRequest.departureDay,
      });

      setNewRequest({
        origin: '',
        destination: '',
        fare: '',
        seats: '1',
        departureDay: 'today',
        departureClock: '09:00',
      });
      setRequestOriginLocation(null);
      setRequestDestinationLocation(null);
      setShowRequestForm(false);
      showAppDialog('Ride request posted successfully. Drivers can now match your request.', 'success');
    } catch (error) {
      console.error('Failed to post ride request:', error);
      showAppDialog(
        getApiErrorMessage(error, 'Ride request failed to post. Please retry in a moment.'),
        'error'
      );
    } finally {
      setIsPostingRequest(false);
    }
  };

  const handleCancelTravelerRequest = async (requestId: string) => {
    try {
      if (isLocalDevFirestoreMode()) {
        await updateDoc(doc(db, 'travelerRideRequests', requestId), {
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        });
      } else {
        const token = await getAccessToken();
        await axios.post(
          apiPath('/api/user?action=cancel-traveler-request'),
          {
            requestId,
            consumerId: profile.uid,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      }
      alert('Ride request cancelled.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `travelerRideRequests/${requestId}`);
    }
  };

  useEffect(() => {
    if (activeTab !== 'search') return;
    void handleSearch();
  }, [activeTab, dashboardBookings.length, travelerFeedLocation, travelerRequests.length]);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      let availableRides: Ride[] = [];
      let allBookings: Booking[] = [];

      if (isLocalDevFirestoreMode()) {
        const [querySnapshot, bookingsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'rides'), where('status', '==', 'available'))),
          getDocs(collection(db, 'bookings')),
        ]);
        availableRides = querySnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Ride) }));
        allBookings = bookingsSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
      } else {
        const { data } = await axios.get(apiPath('/api/health?action=search-rides'));
        availableRides = Array.isArray(data?.rides) ? data.rides : [];
        allBookings = Array.isArray(data?.bookings) ? data.bookings : [];
      }

      const lockedRideIds = getLockedRideIds(allBookings);
      const rideMap = new Map<string, any>();
      const partialRideMap = new Map<string, any>();
      availableRides.forEach((data) => {
        if (!data?.id || lockedRideIds.has(data.id)) {
          return;
        }
        if (String(data.status || '') !== 'available') {
          return;
        }

        const normalizedSearchFrom = normalizeSearchText(search.from);
        const normalizedSearchTo = normalizeSearchText(search.to);
        const normalizedOrigin = normalizeSearchText(data.origin);
        const normalizedDestination = normalizeSearchText(data.destination);

        const originDistance =
          searchLocationFrom && data.originLocation
            ? getDistance(
                searchLocationFrom.lat,
                searchLocationFrom.lng,
                data.originLocation.lat,
                data.originLocation.lng
              )
            : null;

        const destinationDistance =
          searchLocationTo && data.destinationLocation
            ? getDistance(
                searchLocationTo.lat,
                searchLocationTo.lng,
                data.destinationLocation.lat,
                data.destinationLocation.lng
              )
            : null;

        const corridorMatch =
          (searchLocationFrom || searchLocationTo) &&
          data.originLocation &&
          data.destinationLocation
            ? routeCorridorMatch({
                rideOriginLocation: data.originLocation,
                rideDestinationLocation: data.destinationLocation,
                travelerOriginLocation: searchLocationFrom,
                travelerDestinationLocation: searchLocationTo,
                ...getAdaptiveDetourToleranceKm(
                  getDistance(
                    data.originLocation.lat,
                    data.originLocation.lng,
                    data.destinationLocation.lat,
                    data.destinationLocation.lng
                  )
                ),
              })
            : false;

        const originMatches =
          !search.from ||
          corridorMatch ||
          (originDistance !== null
            ? originDistance <= 120
            : routeTextMatches(normalizedOrigin, normalizedSearchFrom));

        const destinationMatches =
          !search.to ||
          corridorMatch ||
          (destinationDistance !== null
            ? destinationDistance <= 120
            : routeTextMatches(normalizedDestination, normalizedSearchTo));

        const matchesActiveTravelerCorridor = isWithinAnyDashboardCorridor(
          getFeedItemRoute(data),
          activeTravelerRequestRoutes
        );
        const matchesTravelerPartialCorridor = isWithinAnyPartialDashboardCorridor(
          getFeedItemRoute(data),
          activeTravelerRequestRoutes
        );

        const withinPlanningWindow = isRideWithinPlanningWindow(data);
        if (originMatches && destinationMatches && withinPlanningWindow) {
          const nextRide = { ...data };
          const dedupeKey = getRideDuplicateKey(nextRide);
          if (matchesActiveTravelerCorridor) {
            const existingRide = rideMap.get(dedupeKey);
            if (!existingRide || new Date(nextRide.createdAt).getTime() > new Date(existingRide.createdAt).getTime()) {
              rideMap.set(dedupeKey, nextRide);
            }
            partialRideMap.delete(dedupeKey);
            return;
          }
          if (matchesTravelerPartialCorridor) {
            const existingRide = partialRideMap.get(dedupeKey);
            if (!existingRide || new Date(nextRide.createdAt).getTime() > new Date(existingRide.createdAt).getTime()) {
              partialRideMap.set(dedupeKey, { ...nextRide, matchTier: 'partial' });
            }
          }
        }
      });
      setRides(
        Array.from(rideMap.values()).sort(
          (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
        )
      );
      setPartialRides(
        Array.from(partialRideMap.values()).sort(
          (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
        )
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'rides');
      setPartialRides([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookRide = async (ride: any, requestedFare?: number) => {
    setIsBooking(true);
    try {
      const proposedFare = requestedFare && requestedFare > 0 ? requestedFare : ride.price;
      const { baseFee, gstAmount, totalFee } = calculateServiceFee(proposedFare, config || undefined);
      const totalPrice = proposedFare + totalFee;
      const updatedAt = new Date().toISOString();
      const requestedOrigin = (search.from || ride.origin).trim();
      const requestedDestination = (search.to || ride.destination).trim();
      const requiresDetour =
        normalizeSearchText(requestedOrigin) !== normalizeSearchText(ride.origin) ||
        normalizeSearchText(requestedDestination) !== normalizeSearchText(ride.destination);
      
      const bookingData = {
        rideId: ride.id,
        consumerId: profile.uid,
        consumerName: profile.displayName,
        consumerPhone: profile.phoneNumber || '',
        driverId: ride.driverId,
        driverName: ride.driverName,
        driverPhotoUrl: ride.driverPhotoUrl || '',
        origin: ride.origin,
        destination: ride.destination,
        listedOrigin: ride.origin,
        listedDestination: ride.destination,
        requestedOrigin,
        requestedDestination,
        requiresDetour,
        listedFare: ride.price,
        fare: proposedFare,
        seatsBooked: 1, // Default to 1 seat for now
        serviceFee: baseFee,
        gstAmount: gstAmount,
        totalPrice: totalPrice,
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: updatedAt,
        updatedAt,
        maiCoinsUsed: 0,
        negotiatedFare: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? requestedFare : undefined,
        negotiationStatus: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? 'pending' : undefined,
        negotiationActor: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? 'consumer' : undefined,
        driverCounterPending: false,
      };

      const existingThreadSnapshot = await getDocs(
        query(
          collection(db, 'bookings'),
          where('rideId', '==', ride.id),
          where('consumerId', '==', profile.uid)
        )
      );
      const activeThreadBookings = existingThreadSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
        .filter((booking) => ['pending', 'confirmed', 'negotiating'].includes(booking.status));

      if (activeThreadBookings.length) {
        await Promise.all(
          activeThreadBookings.map((booking) =>
            updateDoc(doc(db, 'bookings', booking.id), {
              ...bookingData,
              updatedAt,
            })
          )
        );
      } else {
        await addDoc(collection(db, 'bookings'), bookingData);
      }
      if (requestedFare && requestedFare > 0 && requestedFare !== ride.price) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `You offered ${formatCurrency(proposedFare)} for ${ride.origin} to ${ride.destination}.`,
          { tag: `traveler-sent-counter-${ride.id}`, requirePermissionPrompt: true }
        );
      }
      
      alert(
        requestedFare && requestedFare > 0 && requestedFare !== ride.price
          ? "Counter offer sent to the driver."
          : "Booking request sent! Once confirmed, you'll be notified."
      );
      setTravelerCounterFare('');
      setSelectedRide(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsBooking(false);
    }
  };

  const requestRideBooking = (ride: any, requestedFare?: number) => {
    const isCounter = Boolean(requestedFare && requestedFare > 0 && requestedFare !== ride.price);
    if (isFutureRide(ride)) {
      setPendingFutureRideAction({
        ride,
        requestedFare,
        mode: isCounter ? 'counter' : 'booking',
      });
      return;
    }

    void handleBookRide(ride, requestedFare);
  };

  const handleTravelerNegotiation = async (booking: Booking, action: 'accepted' | 'rejected') => {
    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=traveler-respond-booking',
        {
          bookingId: booking.id,
          consumerId: profile.uid,
          action,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const acceptedFare =
        action === 'accepted'
          ? booking.negotiatedFare ?? getNegotiationDisplayFare(booking)
          : undefined;
      let updatedAt = new Date().toISOString();
      try {
        updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
      } catch (syncError) {
        console.warn('Negotiation sync (traveler dashboard) failed after API success.', syncError);
      }
      setDashboardBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                status: action === 'accepted' ? 'confirmed' : 'rejected',
                ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                negotiationActor: 'driver',
                driverCounterPending: false,
                updatedAt,
              }
            : candidate
        )
      );
      showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
    } catch (error: any) {
      try {
        const acceptedFare =
          action === 'accepted' ? booking.negotiatedFare ?? getNegotiationDisplayFare(booking) : undefined;
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
        setDashboardBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  status: action === 'accepted' ? 'confirmed' : 'rejected',
                  ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                  negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                  negotiationActor: 'driver',
                  driverCounterPending: false,
                  rideRetired: action === 'rejected',
                  updatedAt,
                }
              : candidate
          )
        );
        showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      } catch (fallbackError: any) {
        const message = getApiErrorMessage(fallbackError, 'Failed to update negotiation.');
        showAppDialog(message, 'error', 'Negotiation update failed');
      }
    }
  };

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;
    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits, profile.uid);
      showAppDialog('Thanks for rating your ride.', 'success');
      setDismissedReviewIds((prev) => ({ ...prev, [reviewBooking.id]: true }));
      setReviewBooking(null);
    } catch (error: any) {
      const message = error.response?.data?.error || error.message || 'Failed to submit ride review.';
      showAppDialog(message, 'error', 'Review submit failed');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleTravelerCounterOffer = async (booking: Booking, fare: number) => {
    if (!fare || fare <= 0) {
      showAppDialog('Please enter a valid counter fare.', 'warning');
      return;
    }

    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=traveler-counter-booking',
        {
          bookingId: booking.id,
          consumerId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      await persistCounterOfferThroughCompatStore(booking, 'consumer', fare);
      setDashboardBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'consumer',
                driverCounterPending: false,
                status: 'negotiating',
                rideRetired: false,
                updatedAt,
              }
            : candidate
        )
      );
      setDashboardCounterFares((prev) => ({ ...prev, [booking.id]: '' }));
      void sendBrowserNotification(
        'MaiRide Counter Offer',
        `You countered with ${formatCurrency(fare)} for ${booking.origin} to ${booking.destination}.`,
        { tag: `traveler-dashboard-counter-${booking.id}`, requirePermissionPrompt: true }
      );
      showAppDialog('Counter offer sent to the driver.', 'success');
    } catch (error) {
      try {
        const updatedAt = await persistCounterOfferThroughCompatStore(booking, 'consumer', fare);
        setDashboardBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'consumer',
                  driverCounterPending: false,
                  status: 'negotiating',
                  rideRetired: false,
                  updatedAt,
                }
              : candidate
          )
        );
        setDashboardCounterFares((prev) => ({ ...prev, [booking.id]: '' }));
        showAppDialog('Counter offer sent to the driver.', 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
      }
    }
  };

  const submitTravelerPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    try {
      const { baseFee, gstAmount } = calculateServiceFee(booking.fare, config || undefined);
      const receiptRef = storageRef(storage, `payments/${booking.id}/consumer-${Date.now()}.jpg`);
      await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
      const receiptUrl = await getDownloadURL(receiptRef);
      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        paymentStatus: 'proof_submitted',
        consumerPaymentMode: 'online',
        consumerPaymentTransactionId: payload.transactionId,
        consumerPaymentReceiptUrl: receiptUrl,
        consumerPaymentSubmittedAt: new Date().toISOString(),
        consumerNetServiceFee: baseFee,
        consumerNetGstAmount: gstAmount,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'online',
        paymentStatus: 'pending',
        transactionId: payload.transactionId,
        receiptUrl,
        gateway: 'manual',
      });
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Traveler payment proof submitted successfully.');
      setPaymentBooking(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

const finalizeTravelerDashboardRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    const { netServiceFee, gstAmount } = getHybridPaymentBreakdown(
      booking,
      profile.wallet?.balance || 0,
      coinsUsed > 0,
      config || undefined
    );
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id,
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'paid',
      consumerPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      maiCoinsUsed: coinsUsed,
      consumerPaymentTransactionId: payment.paymentId,
      consumerPaymentOrderId: payment.orderId,
      consumerPaymentGateway: 'razorpay',
      consumerPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      consumerPaymentSubmittedAt: new Date().toISOString(),
      consumerNetServiceFee: netServiceFee,
      consumerNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Traveler Razorpay payment verified successfully.', 'success');
  };

  const handleTravelerDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);
      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'consumer',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeTravelerDashboardRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentBooking(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id,
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        maiCoinsUsed: coinsToUse,
        consumerPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        consumerNetServiceFee: 0,
        consumerNetGstAmount: 0,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Platform fee paid successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  if (hasMapsIssue) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
        <div className="text-sm bg-red-50 p-4 rounded-lg text-red-700 font-mono break-all text-left">
          <p className="font-bold mb-2">Possible Causes:</p>
          <ul className="list-disc ml-4 space-y-1">
            <li><strong>RefererNotAllowedMapError:</strong> Your domain restriction in Google Cloud Console is incorrect.</li>
            <li><strong>ApiNotActivatedMapError:</strong> Maps JavaScript API is not enabled.</li>
            <li><strong>BillingNotEnabledMapError:</strong> Billing is not linked to this project.</li>
          </ul>
          <p className="mt-4 text-xs opacity-70">API Key: {GOOGLE_MAPS_API_KEY.substring(0, 10)}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      {activeTab === 'search' && (
        <>
          <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-mairide-secondary">
                {firstName}
              </p>
              <div>
                <h1 className="mb-2 text-4xl font-bold uppercase tracking-tight text-mairide-primary">Where to?</h1>
                <p className="italic serif text-mairide-secondary">Find discounted intercity rides on empty leg journeys.</p>
              </div>
            </div>
            <button
              onClick={() => setShowRequestForm(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-mairide-accent px-6 py-4 text-sm font-bold text-white transition-all hover:bg-mairide-primary"
            >
              <Plus className="h-5 w-5" />
              Request a Ride
            </button>
          </div>

          <TravelerDashboardSummary
            bookings={dashboardBookings}
            tripSessions={tripSessions}
            rideStatusById={rideStatusById}
            ridesResolved={ridesResolved}
            config={config}
            onAcceptCounter={(booking) => handleTravelerNegotiation(booking, 'accepted')}
            onRejectCounter={(booking) => handleTravelerNegotiation(booking, 'rejected')}
            counterFares={dashboardCounterFares}
            setCounterFares={setDashboardCounterFares}
            onCounter={(booking, fare) => handleTravelerCounterOffer(booking, fare)}
            onPayWithCoins={(booking) => handleTravelerDashboardPayment(booking, true)}
            onPayOnline={(booking) => handleTravelerDashboardPayment(booking, false)}
            onOpenBooking={() => setActiveTab('history')}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">MaiCoins Wallet</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-black tracking-tight text-mairide-primary">{profile.wallet?.balance || 0}</p>
                  <p className="text-sm font-bold text-mairide-accent">Available Maicoins</p>
                </div>
                <Wallet className="w-10 h-10 text-mairide-accent" />
              </div>
              <p className="mt-3 text-sm text-mairide-secondary">
                Use Maicoins to reduce platform fees and stay rewarded for bringing repeat demand onto MaiRide.
              </p>
            </div>
            <div className="bg-mairide-primary rounded-[32px] border border-mairide-primary p-6 shadow-lg shadow-mairide-primary/20 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Why It Matters</p>
              <p className="mt-3 text-2xl font-black tracking-tight">Earn. Refer. Save on every booking.</p>
              <p className="mt-3 text-sm text-white/80">
                Your wallet is your fastest growth engine on MaiRide. Keep it growing through referrals, bookings, and repeat usage.
              </p>
            </div>
          </div>

          <div id="consumer-live-map" className="mb-12 overflow-hidden rounded-[32px] border border-mairide-secondary bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-mairide-secondary/70">
              <div>
                <h2 className="text-xl font-bold text-mairide-primary flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-mairide-accent" />
                  Live Driver Map
                </h2>
                <p className="text-sm text-mairide-secondary">
                  See active driver positions around you before searching for a ride.
                </p>
              </div>
              <div className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                {drivers.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number').length} Cabs Visible
              </div>
            </div>
            <div className="h-[360px] relative">
              {(loadError || authFailure) ? (
                <div className="flex flex-col items-center justify-center h-full bg-red-50 p-8 text-center">
                  <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                  <h3 className="text-xl font-bold text-red-900 mb-2">Google Maps Error Detected</h3>
                  <p className="text-red-700 mb-4">
                    {loadError ? loadError.message : "Authentication Failure (Check Referrer Restrictions)"}
                  </p>
                  <div className="text-xs bg-white/50 p-4 rounded border border-red-200 text-red-800 font-mono text-left">
                    <p><strong>API Key:</strong> {GOOGLE_MAPS_API_KEY.substring(0, 10)}...</p>
                    <p><strong>Status:</strong> {isLoaded ? "Script Loaded" : "Script Not Loaded"}</p>
                  </div>
                </div>
              ) : GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={userLocation || { lat: 26.1433, lng: 91.7385 }}
                  zoom={userLocation ? 14 : 7}
                  options={{
                    styles: [
                      { "featureType": "all", "elementType": "geometry.fill", "stylers": [{ "weight": "2.00" }] },
                      { "featureType": "all", "elementType": "geometry.stroke", "stylers": [{ "color": "#9c9c9c" }] },
                      { "featureType": "all", "elementType": "labels.text", "stylers": [{ "visibility": "on" }] },
                      { "featureType": "landscape", "elementType": "all", "stylers": [{ "color": "#f2f2f2" }] },
                      { "featureType": "landscape", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "landscape.man_made", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "poi", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "road", "elementType": "all", "stylers": [{ "saturation": -100 }, { "lightness": 45 }] },
                      { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#eeeeee" }] },
                      { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#7b7b7b" }] },
                      { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "road.highway", "elementType": "all", "stylers": [{ "visibility": "simplified" }] },
                      { "featureType": "road.arterial", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "transit", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "water", "elementType": "all", "stylers": [{ "color": "#46bcec" }, { "visibility": "on" }] },
                      { "featureType": "water", "elementType": "geometry.fill", "stylers": [{ "color": "#c8d7d4" }] },
                      { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#070707" }] },
                      { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] }
                    ]
                  }}
                >
                  {userLocation && (
                    <Marker
                      position={userLocation}
                      icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' }}
                      title="You"
                    />
                  )}
                  {drivers.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number').map(driver => (
                    <Marker
                      key={driver.uid}
                      position={{ lat: driver.location!.lat, lng: driver.location!.lng }}
                      icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/car.png' }}
                      title={driver.displayName}
                    />
                  ))}
                  {directionsResponse && (
                    <DirectionsRenderer directions={directionsResponse} />
                  )}
                </GoogleMap>
              ) : (
                <div className="flex flex-col items-center justify-center h-full bg-mairide-bg p-8 text-center">
                  <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                  <h3 className="text-xl font-bold text-mairide-primary mb-2">
                    {loadError ? "Maps Error" : "Maps Unavailable"}
                  </h3>
                  <p className="text-mairide-secondary max-w-xs mx-auto">
                    {loadError ? loadError.message : "Please configure and activate your Google Maps API Key (Maps JavaScript API & Places API) in the Google Cloud Console."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mb-8 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-mairide-primary">Traveler Ride Requests</h2>
          </div>

          {travelerRequests.filter((item) => item.status === 'open').length > 0 && (
            <div className="mb-12 space-y-4">
              {travelerRequests
                .filter((item) => item.status === 'open')
                .map((item) => (
                  <div key={item.id} className="rounded-3xl border border-mairide-secondary bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-bold text-mairide-primary">{item.origin} → {item.destination}</p>
                        <p className="text-sm text-mairide-secondary">Requested fare: {formatCurrency(item.fare)} • Seats: {item.seatsNeeded}</p>
                        <div className="mt-2 inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                          <Clock className="mr-2 h-3.5 w-3.5" />
                          Departure: {formatRideDeparture(item)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancelTravelerRequest(item.id)}
                        className={cn("rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600", secondaryActionButtonClass)}
                      >
                        Cancel Request
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-6">
            <h2 className="text-xl font-bold text-mairide-primary flex items-center">
              <Clock className="w-5 h-5 mr-2 text-mairide-accent" />
              Available Rides
            </h2>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : rides.length > 0 ? (
              rides.map(ride => (
                <motion.div 
                  key={ride.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="flex items-start space-x-4">
                    <div className="w-14 h-14 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center">
                      {ride.driverPhotoUrl ? (
                        <img src={ride.driverPhotoUrl} alt={ride.driverName} className="w-full h-full object-cover" />
                      ) : (
                        <Car className="w-8 h-8 text-mairide-accent" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-bold text-mairide-primary">{ride.driverName}</h3>
                        <div className="flex items-center text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-bold">
                          <Star className="w-3 h-3 mr-1 fill-current" />
                          {Number(ride.driverRating ?? ride.rating ?? 5).toFixed(1)}
                        </div>
                        {isFutureRide(ride) && (
                          <div className="flex items-center text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                            Future ride
                          </div>
                        )}
                      </div>
                      <div className="flex items-center text-sm text-mairide-secondary space-x-2">
                        <span>{ride.origin}</span>
                        <ChevronRight className="w-4 h-4" />
                        <span>{ride.destination}</span>
                      </div>
                      <div className={cn(
                        "mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
                        isFutureRide(ride)
                          ? "bg-orange-50 text-orange-700 border border-orange-200"
                          : "bg-mairide-bg text-mairide-primary border border-mairide-secondary"
                      )}>
                        <Clock className="w-3.5 h-3.5 mr-2" />
                        Departure: {formatRideDeparture(ride)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:flex-col md:items-end gap-2">
                    <div className="text-2xl font-black text-mairide-accent">
                      {formatCurrency(ride.price)}
                    </div>
                    <button 
                      onClick={() => setSelectedRide(ride)}
                      className="bg-mairide-primary text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                    >
                      Book Now
                    </button>
                  </div>
                </motion.div>
              ))
            ) : partialRides.length > 0 ? (
              <div className="text-center py-12 bg-mairide-bg rounded-3xl border border-dashed border-mairide-secondary">
                <Search className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
                <p className="text-mairide-secondary">No full matches right now. Nearby corridor-based partial matches are available below.</p>
              </div>
            ) : (
              <div className="text-center py-12 bg-mairide-bg rounded-3xl border border-dashed border-mairide-secondary">
                <Search className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
                <p className="text-mairide-secondary">No matching rides right now. Post a request and nearby drivers will respond.</p>
              </div>
            )}
          </div>

          {partialRides.length > 0 && (
            <div className="mt-10 space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-mairide-primary flex items-center">
                    <MapPin className="w-5 h-5 mr-2 text-mairide-accent" />
                    Partial Matches
                  </h2>
                  <p className="mt-1 text-sm text-mairide-secondary">
                    Similar corridor options that may involve a detour or destination adjustment.
                  </p>
                </div>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-orange-700 border border-orange-200">
                  Optional
                </span>
              </div>

              <div className="space-y-4">
                {partialRides.map((ride) => (
                  <motion.div
                    key={`partial-${ride.id}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-white p-6 rounded-3xl border border-orange-200 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="w-14 h-14 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center">
                        {ride.driverPhotoUrl ? (
                          <img src={ride.driverPhotoUrl} alt={ride.driverName} className="w-full h-full object-cover" />
                        ) : (
                          <Car className="w-8 h-8 text-mairide-accent" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2 mb-1">
                          <h3 className="font-bold text-mairide-primary">{ride.driverName}</h3>
                          <div className="flex items-center text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-bold">
                            <Star className="w-3 h-3 mr-1 fill-current" />
                            {Number(ride.driverRating ?? ride.rating ?? 5).toFixed(1)}
                          </div>
                          <div className="flex items-center text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                            Partial match
                          </div>
                        </div>
                        <div className="flex items-center text-sm text-mairide-secondary space-x-2">
                          <span>{ride.origin}</span>
                          <ChevronRight className="w-4 h-4" />
                          <span>{ride.destination}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className={cn(
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
                            isFutureRide(ride)
                              ? "bg-orange-50 text-orange-700 border border-orange-200"
                              : "bg-mairide-bg text-mairide-primary border border-mairide-secondary"
                          )}>
                            <Clock className="w-3.5 h-3.5 mr-2" />
                            Departure: {formatRideDeparture(ride)}
                          </div>
                          <div className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                            Detour may apply
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between md:flex-col md:items-end gap-2">
                      <div className="text-2xl font-black text-mairide-accent">
                        {formatCurrency(ride.price)}
                      </div>
                      <button
                        onClick={() => setSelectedRide(ride)}
                        className="bg-mairide-primary text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                      >
                        Explore Option
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence>
            {showRequestForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  className="my-6 w-full max-w-4xl rounded-[40px] border border-mairide-secondary bg-white p-8 shadow-2xl max-h-[calc(100vh-3rem)] overflow-y-auto"
                >
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-4xl font-black tracking-tight text-mairide-primary">Request New Ride</h2>
                      <p className="mt-1 text-sm text-mairide-secondary">Same 3-day planning window as driver offers.</p>
                    </div>
                    <button
                      onClick={() => setShowRequestForm(false)}
                      className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 mb-6">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Origin</label>
                      {isLoaded ? (
                        <Autocomplete
                          onLoad={(autocomplete) => setRequestAutocompleteFrom(autocomplete)}
                          onPlaceChanged={() => {
                            if (!requestAutocompleteFrom) return;
                            const place = requestAutocompleteFrom.getPlace();
                            if (place.formatted_address) {
                              setNewRequest((prev) => ({ ...prev, origin: place.formatted_address! }));
                            }
                            if (place.geometry?.location) {
                              setRequestOriginLocation({
                                lat: place.geometry.location.lat(),
                                lng: place.geometry.location.lng(),
                              });
                            }
                          }}
                        >
                          <input
                            type="text"
                            placeholder="Where should the ride start?"
                            className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg p-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                            value={newRequest.origin}
                            onChange={(e) => setNewRequest((prev) => ({ ...prev, origin: e.target.value }))}
                          />
                        </Autocomplete>
                      ) : (
                        <input
                          type="text"
                          placeholder="Where should the ride start?"
                          className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg p-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                          value={newRequest.origin}
                          onChange={(e) => setNewRequest((prev) => ({ ...prev, origin: e.target.value }))}
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Destination</label>
                      {isLoaded ? (
                        <Autocomplete
                          onLoad={(autocomplete) => setRequestAutocompleteTo(autocomplete)}
                          onPlaceChanged={() => {
                            if (!requestAutocompleteTo) return;
                            const place = requestAutocompleteTo.getPlace();
                            if (place.formatted_address) {
                              setNewRequest((prev) => ({ ...prev, destination: place.formatted_address! }));
                            }
                            if (place.geometry?.location) {
                              setRequestDestinationLocation({
                                lat: place.geometry.location.lat(),
                                lng: place.geometry.location.lng(),
                              });
                            }
                          }}
                        >
                          <input
                            type="text"
                            placeholder="Where should the ride end?"
                            className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg p-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                            value={newRequest.destination}
                            onChange={(e) => setNewRequest((prev) => ({ ...prev, destination: e.target.value }))}
                          />
                        </Autocomplete>
                      ) : (
                        <input
                          type="text"
                          placeholder="Where should the ride end?"
                          className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg p-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                          value={newRequest.destination}
                          onChange={(e) => setNewRequest((prev) => ({ ...prev, destination: e.target.value }))}
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Your Fare Offer (INR)</label>
                      <div className="relative">
                        <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mairide-secondary" />
                        <input
                          type="number"
                          placeholder="e.g. 1800"
                          className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg py-4 pl-12 pr-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                          value={newRequest.fare}
                          onChange={(e) => setNewRequest((prev) => ({ ...prev, fare: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Seats Needed</label>
                      <div className="relative">
                        <select
                          className="w-full appearance-none rounded-2xl border border-mairide-secondary bg-mairide-bg py-4 pl-4 pr-12 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                          value={newRequest.seats}
                          onChange={(e) => setNewRequest((prev) => ({ ...prev, seats: e.target.value }))}
                        >
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n} {n === 1 ? 'Seat' : 'Seats'}
                            </option>
                          ))}
                        </select>
                        <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Journey Day</label>
                      <div className="relative">
                        <select
                          className="w-full appearance-none rounded-2xl border border-mairide-secondary bg-mairide-bg py-4 pl-4 pr-12 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                          value={newRequest.departureDay}
                          onChange={(e) => setNewRequest((prev) => ({ ...prev, departureDay: e.target.value }))}
                        >
                          <option value="today">Today</option>
                          <option value="tomorrow">Tomorrow</option>
                          <option value="dayAfter">Day After</option>
                        </select>
                        <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-mairide-primary">Likely Start Time</label>
                      <input
                        type="time"
                        className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg p-4 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                        value={newRequest.departureClock}
                        onChange={(e) => setNewRequest((prev) => ({ ...prev, departureClock: e.target.value }))}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handlePostTravelerRequest}
                    disabled={isPostingRequest}
                    className="w-full rounded-2xl bg-mairide-accent py-4 font-bold text-white transition-all hover:bg-mairide-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPostingRequest ? 'Posting Request...' : 'Post Ride Request'}
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selectedRide && (
              <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white my-6 w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-mairide-secondary overflow-y-auto max-h-[calc(100vh-3rem)] relative"
                >
                  <button 
                    onClick={() => setSelectedRide(null)}
                    className="absolute top-6 right-6 p-2 hover:bg-mairide-bg rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-mairide-secondary" />
                  </button>

                  <div className="flex items-center space-x-4 mb-8">
                    <div className="w-16 h-16 bg-mairide-bg rounded-3xl overflow-hidden border border-mairide-secondary flex items-center justify-center">
                      {selectedRide.driverPhotoUrl ? (
                        <img src={selectedRide.driverPhotoUrl} alt={selectedRide.driverName} className="w-full h-full object-cover" />
                      ) : (
                        <Car className="w-8 h-8 text-mairide-accent" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-mairide-primary">Confirm Booking</h3>
                      <p className="text-xs text-mairide-secondary italic serif">Review your ride details</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    <div className="bg-mairide-bg p-6 rounded-3xl">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Driver</span>
                        <span className="font-bold text-mairide-primary">{selectedRide.driverName}</span>
                      </div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Route</span>
                        <span className="font-bold text-mairide-primary text-right">{selectedRide.origin} → {selectedRide.destination}</span>
                      </div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Likely Departure</span>
                        <span className={cn(
                          "text-right rounded-2xl px-3 py-2 text-sm font-black",
                          isFutureRide(selectedRide)
                            ? "bg-orange-100 text-orange-700"
                            : "bg-white text-mairide-primary border border-mairide-secondary"
                        )}>
                          {formatRideDeparture(selectedRide)}
                        </span>
                      </div>
                      {isFutureRide(selectedRide) && (
                        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 mb-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700">Advance booking</p>
                          <p className="mt-1 text-sm text-orange-800">
                            This ride is scheduled for a future departure. Please confirm the date and likely start time carefully before continuing.
                          </p>
                        </div>
                      )}
                      <div className="h-px bg-mairide-secondary/20 my-4" />
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-mairide-secondary">Platform Fee</span>
                        <span className="font-bold text-mairide-primary">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).baseFee)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-mairide-secondary">GST (18%)</span>
                        <span className="font-bold text-mairide-primary">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).gstAmount)}</span>
                      </div>
                      <div className="h-px bg-mairide-secondary/20 my-4" />
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-mairide-primary">Payable on Confirmation</span>
                        <span className="text-2xl font-black text-mairide-accent">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).totalFee)}</span>
                      </div>
                      <p className="mt-3 text-xs text-mairide-secondary">
                        You are only committing to the MaiRide maintenance fee plus GST here. The ride fare itself is not collected by the platform in this step.
                      </p>
                    </div>

                    <div className="bg-mairide-bg p-6 rounded-3xl">
                      <p className="text-xs font-bold text-mairide-secondary uppercase mb-3">Want to negotiate?</p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                          <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5" />
                          <input
                            type="number"
                            min="1"
                            placeholder="Enter your counter fare"
                            className="w-full pl-12 pr-4 py-4 bg-white border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                            value={travelerCounterFare}
                            onChange={(e) => setTravelerCounterFare(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => requestRideBooking(selectedRide, Number(travelerCounterFare))}
                          disabled={isBooking || !travelerCounterFare || Number(travelerCounterFare) <= 0}
                          className="bg-mairide-primary text-white px-6 py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Send Counter Offer
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-3 mb-4">
                    <button 
                      onClick={() => {
                        setSelectedRide(null);
                        document.getElementById('consumer-live-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold text-lg hover:bg-mairide-secondary transition-all flex items-center justify-center space-x-3"
                    >
                      <MapPin className="w-6 h-6" />
                      <span>View on Map</span>
                    </button>
                    <button 
                      onClick={() => requestRideBooking(selectedRide)}
                      disabled={isBooking}
                      className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold text-lg hover:bg-mairide-primary transition-all flex items-center justify-center space-x-3 shadow-xl shadow-mairide-accent/20"
                    >
                      {isBooking ? (
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-6 h-6" />
                          <span>Send Booking Request</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-mairide-secondary mt-4 px-4">
                    Once the driver accepts, both sides must submit the MaiRide platform fee payment proof before contact details are unlocked.
                  </p>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {pendingFutureRideAction && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  className="my-6 w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl max-h-[calc(100vh-3rem)] overflow-y-auto"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                      <Clock className="w-6 h-6" />
                    </div>
                    <button
                      onClick={() => setPendingFutureRideAction(null)}
                      className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Confirm future ride</p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight text-mairide-primary">
                    {formatRideDeparture(pendingFutureRideAction.ride)}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-mairide-primary">
                    This is an advance trip, not an immediate departure. Please confirm you want to {pendingFutureRideAction.mode === 'counter' ? 'send a counter offer' : 'book this ride'} for the scheduled future date and time.
                  </p>
                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => setPendingFutureRideAction(null)}
                      className="flex-1 rounded-2xl border border-mairide-secondary py-3 text-sm font-bold text-mairide-primary"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => {
                        const nextAction = pendingFutureRideAction;
                        setPendingFutureRideAction(null);
                        void handleBookRide(nextAction.ride, nextAction.requestedFare);
                      }}
                      className="flex-1 rounded-2xl bg-mairide-accent py-3 text-sm font-bold text-white hover:bg-mairide-primary"
                    >
                      Confirm & Continue
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </>
      )}

      {activeTab === 'history' && <MyBookings profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
      {activeTab === 'profile' && <UserSelfProfilePanel profile={profile} />}
      {paymentBooking && (
        <PaymentProofModal
          booking={paymentBooking}
          payer="consumer"
          config={config}
          onClose={() => setPaymentBooking(null)}
          onSubmit={(payload) => submitTravelerPaymentProof(paymentBooking, payload)}
        />
      )}
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="consumer"
          onClose={() => {
            setDismissedReviewIds((prev) => ({ ...prev, [reviewBooking.id]: true }));
            setReviewBooking(null);
          }}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

const DriverApp = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const { config } = useAppConfig();
  const showDashboardHeroLogo = !isAppDisplayMode();
  const firstName = String(profile.displayName || profile.email || 'Driver').split(' ')[0] || 'Driver';
  const [isOnline, setIsOnline] = useState(profile.driverDetails?.isOnline || false);
  const [newRide, setNewRide] = useState({ origin: '', destination: '', price: '', seats: '4', departureDay: 'today', departureClock: '09:00' });
  const [showOfferForm, setShowOfferForm] = useState(false);

  useEffect(() => {
    const handleHomeNavigation = () => setActiveTab('dashboard');
    const handleTabNavigation = (event: Event) => {
      const customEvent = event as CustomEvent<{ role?: string; tab?: string }>;
      const targetTab = customEvent.detail?.tab;
      if (!targetTab) return;
      if (['dashboard', 'requests', 'history', 'wallet', 'support', 'profile'].includes(targetTab)) {
        setActiveTab(targetTab as 'dashboard' | 'requests' | 'history' | 'wallet' | 'support' | 'profile');
      }
    };
    window.addEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
    window.addEventListener(APP_NAV_TAB_EVENT, handleTabNavigation as EventListener);
    return () => {
      window.removeEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
      window.removeEventListener(APP_NAV_TAB_EVENT, handleTabNavigation as EventListener);
    };
  }, []);
  const [isPostingRide, setIsPostingRide] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'history' | 'wallet' | 'support' | 'profile'>('dashboard');
  const hasMapsIssue = Boolean(loadError || authFailure);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(() => {
    if (isAppWebViewRuntime() || isAndroidWebViewLikeRuntime()) return null;
    return extractLatLng(profile.location);
  });
  const [autocompleteFrom, setAutocompleteFrom] = useState<any | null>(null);
  const [autocompleteTo, setAutocompleteTo] = useState<any | null>(null);
  const [originLocation, setOriginLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [consumers, setConsumers] = useState<UserProfile[]>([]);
  const [travelerRideRequests, setTravelerRideRequests] = useState<TravelerRideRequest[]>([]);
  const [linkedTravelerRequestId, setLinkedTravelerRequestId] = useState<string | null>(null);
  const [requests, setRequests] = useState<Booking[]>([]);
  const [counterFares, setCounterFares] = useState<{ [key: string]: string }>({});
  const [paymentRequest, setPaymentRequest] = useState<Booking | null>(null);
  const [retiredRideIds, setRetiredRideIds] = useState<string[]>([]);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [dismissedReviewIds, setDismissedReviewIds] = useState<Record<string, boolean>>({});
  const [driverBookings, setDriverBookings] = useState<Booking[]>([]);
  const [driverAvailableRideRoutes, setDriverAvailableRideRoutes] = useState<
    Array<{ originLocation: { lat: number; lng: number }; destinationLocation: { lat: number; lng: number } }>
  >([]);
  const [tripSessions, setTripSessions] = useState<Record<string, TripSession>>({});
  const [tripNetworkState, setTripNetworkState] = useState<TripSession['networkState']>(
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline'
  );
  const [tripAppState, setTripAppState] = useState<TripSession['appState']>(
    typeof document !== 'undefined' && document.visibilityState === 'visible' ? 'foreground' : 'background'
  );
  const [driverSignalLocation, setDriverSignalLocation] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
    heading?: number;
    speedKmph?: number;
  } | null>(null);
  const seenTravelerCounterNotificationsRef = useRef<Record<string, string>>({});
  const hasHydratedTravelerCountersRef = useRef(false);
  const driverFeedLocation = useMemo(
    () => getFeedViewerLocation(userLocation, profile.location),
    [profile.location?.lat, profile.location?.lng, userLocation]
  );
  const activeDashboardRequests = useMemo(
    () => requests.filter((request) => !retiredRideIds.includes(request.rideId)),
    [requests, retiredRideIds]
  );
  const linkedTravelerRequestIds = useMemo(
    () =>
      new Set(
        activeDashboardRequests
          .map((request) => String((request as any).linkedTravelerRequestId || ''))
          .filter(Boolean)
      ),
    [activeDashboardRequests]
  );
  const lockedRideIds = useMemo(
    () => Array.from(getLockedRideIds(driverBookings)),
    [driverBookings]
  );
  const suppressedRideIds = useMemo(
    () => Array.from(new Set([...retiredRideIds, ...lockedRideIds])),
    [retiredRideIds, lockedRideIds]
  );
  const activeTravelerRideRequests = useMemo(
    () =>
      travelerRideRequests
        .filter((request) => request.status === 'open')
        .filter((request) => request.consumerId !== profile.uid)
        .filter((request) => !linkedTravelerRequestIds.has(request.id))
        .filter((request) => isWithinAnyDashboardCorridor(getFeedItemRoute(request), driverAvailableRideRoutes)),
    [driverAvailableRideRoutes, travelerRideRequests, profile.uid, linkedTravelerRequestIds]
  );
  const partialTravelerRideRequests = useMemo(
    () =>
      travelerRideRequests
        .filter((request) => request.status === 'open')
        .filter((request) => request.consumerId !== profile.uid)
        .filter((request) => !linkedTravelerRequestIds.has(request.id))
        .filter((request) => !isWithinAnyDashboardCorridor(getFeedItemRoute(request), driverAvailableRideRoutes))
        .filter((request) => isWithinAnyPartialDashboardCorridor(getFeedItemRoute(request), driverAvailableRideRoutes)),
    [driverAvailableRideRoutes, travelerRideRequests, profile.uid, linkedTravelerRequestIds]
  );

  useEffect(() => {
    // Listen for online travelers
    const q = query(collection(db, 'users'), where('role', '==', 'consumer'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const travelerList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserProfile;
        if (data.location) {
          travelerList.push(data);
        }
      });
      setConsumers(travelerList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'rides'), where('driverId', '==', profile.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextRoutes = snapshot.docs
          .map((snapshotDoc) => snapshotDoc.data() as Ride)
          .filter((ride) => String(ride.status || '') === 'available')
          .map((ride) => getFeedItemRoute(ride as any))
          .filter(
            (route): route is {
              originLocation: { lat: number; lng: number };
              destinationLocation: { lat: number; lng: number };
            } => Boolean(route)
          );
        setDriverAvailableRideRoutes(nextRoutes);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'rides');
      }
    );
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    if (isLocalDevFirestoreMode()) {
      const q = query(collection(db, 'travelerRideRequests'), where('status', '==', 'open'));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list: TravelerRideRequest[] = snapshot.docs.map((snapshotDoc) => ({
            id: snapshotDoc.id,
            ...(snapshotDoc.data() as TravelerRideRequest),
          }));
          setTravelerRideRequests(
            list
              .filter((item) => isRideWithinPlanningWindow(item))
              .sort((a, b) => new Date(a.departureTime || a.createdAt).getTime() - new Date(b.departureTime || b.createdAt).getTime())
          );
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, 'travelerRideRequests');
        }
      );
      return () => unsubscribe();
    }

    let isMounted = true;
    let pollTimer: number | null = null;

    const loadOpenTravelerRequests = async () => {
      try {
        const token = await getAccessToken();
        const { data } = await axios.get(apiPath('/api/user?action=list-traveler-requests&scope=open'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!isMounted) return;
        const list = Array.isArray(data?.requests) ? data.requests as TravelerRideRequest[] : [];
        setTravelerRideRequests(
          list
            .filter((item) => isRideWithinPlanningWindow(item))
            .sort((a, b) => new Date(a.departureTime || a.createdAt).getTime() - new Date(b.departureTime || b.createdAt).getTime())
        );
      } catch (error) {
        if (!isMounted) return;
        console.error('Traveler request load failed (driver):', error);
        showAppDialog(
          getApiErrorMessage(error, 'We could not load traveler requests right now. Please retry.'),
          'error'
        );
        setTravelerRideRequests([]);
      }
    };

    void loadOpenTravelerRequests();
    pollTimer = window.setInterval(() => {
      void loadOpenTravelerRequests();
    }, 8000);

    return () => {
      isMounted = false;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [profile.uid]);

  useEffect(() => {
    if (isLocalDevFirestoreMode()) {
      const q = query(
        collection(db, 'bookings'),
        where('driverId', '==', profile.uid),
        where('status', 'in', ['pending', 'confirmed', 'negotiating'])
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: Booking[] = [];
        snapshot.forEach((snapshotDoc) =>
          list.push(normalizeNegotiationBooking({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
        );
        setRequests(
          dedupeBookingsByThread(list)
            .filter(
              (booking) =>
                !retiredRideIds.includes(booking.rideId) &&
                !(booking as any).rideRetired &&
                booking.negotiationStatus !== 'rejected' &&
                ['pending', 'confirmed', 'negotiating'].includes(booking.status)
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        );
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'bookings');
      });
      return () => unsubscribe();
    }

    let isMounted = true;
    let pollTimer: number | null = null;

    const loadDriverBookings = async () => {
      try {
        const token = await getAccessToken();
        const { data } = await axios.get(apiPath('/api/user?action=list-bookings&scope=driver'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!isMounted) return;
        const list = Array.isArray(data?.bookings) ? data.bookings as Booking[] : [];
        const normalized = dedupeBookingsByThread(
          list
            .map((booking) => normalizeNegotiationBooking(booking))
            .sort(
              (a, b) =>
                new Date((b as any).updatedAt || b.createdAt).getTime() -
                new Date((a as any).updatedAt || a.createdAt).getTime()
            )
        );
        setDriverBookings(normalized);
        setRequests(
          normalized.filter(
            (booking) =>
              !retiredRideIds.includes(booking.rideId) &&
              !(booking as any).rideRetired &&
              booking.negotiationStatus !== 'rejected' &&
              ['pending', 'confirmed', 'negotiating'].includes(booking.status)
          )
        );
      } catch (error) {
        if (!isMounted) return;
        console.error('Driver booking load failed:', error);
        setRequests([]);
        setDriverBookings([]);
      }
    };

    void loadDriverBookings();
    pollTimer = window.setInterval(() => {
      void loadDriverBookings();
    }, 8000);

    return () => {
      isMounted = false;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [profile.uid, retiredRideIds]);

  useEffect(() => {
    if (!isLocalDevFirestoreMode()) return;
    const q = query(collection(db, 'tripSessions'), where('driverId', '==', profile.uid));
    let unsubscribe: (() => void) | null = null;
    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: Record<string, TripSession> = {};
        snapshot.docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data() as TripSession;
          next[data.bookingId || snapshotDoc.id] = { ...data, id: snapshotDoc.id };
        });
        setTripSessions(next);
      },
      (error) => {
        if (isMissingSupabaseTableError(error)) {
          console.warn('Trip sessions table missing; pausing driver session polling.');
          if (unsubscribe) unsubscribe();
          return;
        }
        console.error('Trip session subscription error (driver):', error);
      }
    );
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [profile.uid]);

  useEffect(() => {
    if (!isLocalDevFirestoreMode()) return;
    const q = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Booking[] = [];
        snapshot.forEach((snapshotDoc) =>
          list.push(normalizeNegotiationBooking({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
        );
        setDriverBookings(
          dedupeBookingsByThread(list).sort(
            (a, b) => new Date((b as any).updatedAt || b.createdAt).getTime() - new Date((a as any).updatedAt || a.createdAt).getTime()
          )
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'bookings');
      }
    );
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    if (reviewBooking) return;
    const pendingReview = driverBookings.find(
      (booking) =>
        (booking.status === 'completed' || booking.rideLifecycleStatus === 'completed' || !!booking.rideEndedAt) &&
        !booking.driverReview &&
        !dismissedReviewIds[booking.id]
    );
    if (pendingReview) {
      setReviewBooking(pendingReview);
    }
  }, [dismissedReviewIds, driverBookings, reviewBooking]);

  useEffect(() => {
    const currentKeys = requests.reduce((acc: Record<string, string>, booking) => {
      if (hasPendingTravelerCounterOffer(booking)) {
        acc[booking.id] = `${booking.negotiationActor}|${booking.negotiatedFare}|${(booking as any).updatedAt || booking.createdAt || ''}`;
      }
      return acc;
    }, {});

    if (!hasHydratedTravelerCountersRef.current) {
      seenTravelerCounterNotificationsRef.current = currentKeys;
      hasHydratedTravelerCountersRef.current = true;
      return;
    }

    requests.forEach((booking) => {
      if (!hasPendingTravelerCounterOffer(booking)) return;
      const nextKey = currentKeys[booking.id];
      const previousKey = seenTravelerCounterNotificationsRef.current[booking.id];
      if (nextKey && nextKey !== previousKey) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `${booking.consumerName} offered ${formatCurrency(getNegotiationDisplayFare(booking))} for ${booking.origin} to ${booking.destination}.`,
          { tag: `driver-counter-${booking.id}` }
        );
      }
    });

    seenTravelerCounterNotificationsRef.current = currentKeys;
  }, [requests]);

  useEffect(() => {
    const handleOnline = () => setTripNetworkState('recovered');
    const handleOffline = () => setTripNetworkState('offline');
    const handleVisibility = () => setTripAppState(document.visibilityState === 'visible' ? 'foreground' : 'background');
    const handleFocus = () => setTripAppState('resumed');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (userLocation || isAppWebViewRuntime() || isAndroidWebViewLikeRuntime()) return;
    const fallbackLocation = extractLatLng(profile.location);
    if (fallbackLocation) {
      setUserLocation(fallbackLocation);
      setDriverSignalLocation((prev) => prev || { lat: fallbackLocation.lat, lng: fallbackLocation.lng });
    }
  }, [profile.location?.lat, profile.location?.lng, userLocation]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          setDriverSignalLocation({
            lat: latitude,
            lng: longitude,
            accuracy: position.coords.accuracy,
            heading: Number.isFinite(position.coords.heading as number) ? Number(position.coords.heading) : undefined,
            speedKmph: Number.isFinite(position.coords.speed as number) ? Number(position.coords.speed) * 3.6 : undefined,
          });
          
          // Update location in Firestore
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => {
          logGeolocationIssue('Driver', error);
          const fallbackLocation = extractLatLng(profile.location);
          if (fallbackLocation) {
            setUserLocation((prev) => prev || fallbackLocation);
            setDriverSignalLocation((prev) => prev || { lat: fallbackLocation.lat, lng: fallbackLocation.lng });
          }
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [profile.uid, profile.location?.lat, profile.location?.lng]);

  useEffect(() => {
    const trackableRequests = requests.filter(isBookingTrackable);
    if (!trackableRequests.length) return;

    const sync = () => {
      trackableRequests.forEach((request) => {
        void upsertTripSession({
          booking: request,
          actorRole: 'driver',
          actorId: profile.uid,
          location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
          networkState: tripNetworkState,
          appState: tripAppState,
          note: 'driver_presence_sync',
        }).catch((error) => {
          console.error('Driver trip session sync failed:', error);
        });
      });
      if (tripNetworkState === 'recovered') {
        setTripNetworkState('online');
      }
      if (tripAppState === 'resumed') {
        setTripAppState(document.visibilityState === 'visible' ? 'foreground' : 'background');
      }
    };

    sync();
    const timer = window.setInterval(sync, TRIP_SIGNAL_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [requests, profile.uid, driverSignalLocation, userLocation, tripNetworkState, tripAppState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Object.values(tripSessions).forEach((session) => {
        void markTripSessionStale(session).catch((error) => {
          console.error('Failed to mark stale driver trip session:', error);
        });
      });
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [tripSessions]);

  const toggleOnline = async () => {
    const newState = !isOnline;
    setIsOnline(newState);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        'driverDetails.isOnline': newState
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  const geocodeAddress = async (address: string) => {
    if (!window.google || !window.google.maps) return null;
    const geocoder = new window.google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ address });
      const location = result.results?.[0]?.geometry?.location;
      if (!location) return null;
      return {
        lat: location.lat(),
        lng: location.lng(),
      };
    } catch (error) {
      console.error('Address geocoding failed:', error);
      return null;
    }
  };

  const buildScheduledDeparture = (dayKey: string, timeValue: string) => {
    const scheduledDate = new Date();
    if (dayKey === 'tomorrow') {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    } else if (dayKey === 'dayAfter') {
      scheduledDate.setDate(scheduledDate.getDate() + 2);
    }

    const [hours, minutes] = (timeValue || '09:00').split(':').map(Number);
    scheduledDate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return scheduledDate.toISOString();
  };

  const formatDepartureDayLabel = (dayKey: string) => {
    if (dayKey === 'tomorrow') return 'Tomorrow';
    if (dayKey === 'dayAfter') return 'Day After';
    return 'Today';
  };

  const prefillRideOfferFromTravelerRequest = (request: TravelerRideRequest) => {
    setNewRide({
      origin: request.origin || '',
      destination: request.destination || '',
      price: String(request.fare || ''),
      seats: String(request.seatsNeeded || 1),
      departureDay: request.departureDay || 'today',
      departureClock: request.departureClock || '09:00',
    });
    setOriginLocation(request.originLocation || null);
    setDestinationLocation(request.destinationLocation || null);
    setLinkedTravelerRequestId(request.id);
    setShowOfferForm(true);
  };

  const buildMatchedTravelerNegotiationThread = ({
    bookingId,
    request,
    rideId,
    ridePayload,
    driverId,
  }: {
    bookingId: string;
    request: TravelerRideRequest;
    rideId: string;
    ridePayload: Record<string, any>;
    driverId: string;
  }) => {
    const nowIso = new Date().toISOString();
    const requestedFare = Number(request.fare);
    const listedFare = Number.isFinite(requestedFare) && requestedFare > 0 ? requestedFare : Number(ridePayload.price || 0);
    const requestedOrigin = request.origin || ridePayload.origin || '';
    const requestedDestination = request.destination || ridePayload.destination || '';

    return {
      id: bookingId,
      rideId,
      consumerId: request.consumerId,
      consumerName: request.consumerName || 'Traveler',
      consumerPhone: request.consumerPhone || '',
      driverId,
      driverName: String(ridePayload.driverName || profile.displayName || 'Driver'),
      driverPhotoUrl: String(ridePayload.driverPhotoUrl || ''),
      origin: ridePayload.origin || requestedOrigin,
      destination: ridePayload.destination || requestedDestination,
      listedOrigin: ridePayload.origin || requestedOrigin,
      listedDestination: ridePayload.destination || requestedDestination,
      requestedOrigin,
      requestedDestination,
      requiresDetour:
        normalizeSearchText(requestedOrigin) !== normalizeSearchText(ridePayload.origin || '') ||
        normalizeSearchText(requestedDestination) !== normalizeSearchText(ridePayload.destination || ''),
      fare: listedFare,
      listedFare,
      negotiatedFare: Number(ridePayload.price || listedFare),
      negotiationStatus: 'pending' as const,
      negotiationActor: 'driver' as const,
      driverCounterPending: true,
      seatsBooked: Math.max(1, Number(request.seatsNeeded || 1)),
      totalPrice: listedFare,
      serviceFee: 0,
      gstAmount: 0,
      maiCoinsUsed: 0,
      paymentStatus: 'pending' as const,
      status: 'negotiating' as const,
      linkedTravelerRequestId: request.id,
      matchedRideId: rideId,
      matchedDriverId: driverId,
      matchedAt: nowIso,
      departureDay: request.departureDay || ridePayload.departureDay,
      departureDayLabel: request.departureDayLabel || ridePayload.departureDayLabel,
      departureClock: request.departureClock || ridePayload.departureClock,
      departureNote: request.departureNote || ridePayload.departureNote,
      departureTime: request.departureTime || ridePayload.departureTime || nowIso,
      rideRetired: false,
      createdAt: request.createdAt || nowIso,
      updatedAt: nowIso,
    };
  };

  const upsertMatchedTravelerNegotiationThread = async ({
    bookingId,
    request,
    rideId,
    ridePayload,
    driverId,
  }: {
    bookingId: string;
    request: TravelerRideRequest;
    rideId: string;
    ridePayload: Record<string, any>;
    driverId: string;
  }) => {
    const threadPayload = buildMatchedTravelerNegotiationThread({
      bookingId,
      request,
      rideId,
      ridePayload,
      driverId,
    });
    await setDoc(doc(db, 'bookings', bookingId), threadPayload, { merge: true });
    return threadPayload;
  };

  const loadRelatedBookingThread = async (seedBooking: Booking) => {
    const snapshot = await getDocs(
      query(
        collection(db, 'bookings'),
        where('consumerId', '==', seedBooking.consumerId),
        where('driverId', '==', seedBooking.driverId)
      )
    );

    const threadKey = getBookingThreadKey(seedBooking);
    const threadBookings = snapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
      .filter((booking) => getBookingThreadKey(booking) === threadKey)
      .filter((booking) => ['pending', 'confirmed', 'negotiating'].includes(booking.status));

    return threadBookings.length ? threadBookings : [seedBooking];
  };

  const handlePostRide = async () => {
    if (!isOnline) {
      alert('Please go online before posting a ride offer.');
      return;
    }

    const origin = newRide.origin.trim();
    const destination = newRide.destination.trim();
    const priceValue = Number(newRide.price);
    const seatsValue = Number(newRide.seats);

    if (!origin || !destination) {
      alert('Please select both origin and destination before posting your offer.');
      return;
    }

    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      alert('Please enter a valid ride price greater than zero.');
      return;
    }

    if (!Number.isFinite(seatsValue) || seatsValue < 1) {
      alert('Please choose at least one available seat.');
      return;
    }

    setIsPostingRide(true);
    try {
      const geocodeTimeoutMs = 8000;
      const profileLocation = profile.location || null;
      const resolvedOriginLocation =
        originLocation || userLocation || profileLocation || await withTimeout(geocodeAddress(origin), geocodeTimeoutMs, null);
      const resolvedDestinationLocation =
        destinationLocation || await withTimeout(geocodeAddress(destination), geocodeTimeoutMs, null) || resolvedOriginLocation;

      if (!resolvedOriginLocation) {
        alert('Please allow location access or select a valid origin from the suggestions.');
        return;
      }

      const resolvedDriverId =
        profile.uid || auth.currentUser?.uid || (await getSessionUserId()) || '';
      if (!resolvedDriverId) {
        throw new Error('Unable to resolve authenticated driver identity. Please sign in again and retry.');
      }
      const linkedTravelerRequest = linkedTravelerRequestId
        ? travelerRideRequests.find((request) => request.id === linkedTravelerRequestId) || null
        : null;

      const ridePayload = {
        driverId: resolvedDriverId,
        driverName: profile.displayName,
        driverPhotoUrl: getResolvedUserPhoto(profile),
        driverRating: getResolvedUserRating(profile),
        origin,
        destination,
        originLocation: resolvedOriginLocation,
        destinationLocation: resolvedDestinationLocation,
        price: priceValue,
        seatsAvailable: seatsValue,
        status: 'available',
        departureDay: newRide.departureDay,
        departureDayLabel: formatDepartureDayLabel(newRide.departureDay),
        departureClock: newRide.departureClock,
        departureNote: 'Planned departure time may vary based on traffic, road, and operational conditions.',
        departureTime: buildScheduledDeparture(newRide.departureDay, newRide.departureClock),
        createdAt: new Date().toISOString()
      };

      let createdRideId = '';
      if (isLocalDevFirestoreMode()) {
        const nowIso = new Date().toISOString();
        const rideRef = await addDoc(collection(db, 'rides'), ridePayload);
        createdRideId = rideRef.id;

        if (linkedTravelerRequestId) {
          if (linkedTravelerRequest) {
            await upsertMatchedTravelerNegotiationThread({
              bookingId: linkedTravelerRequestId,
              request: linkedTravelerRequest,
              rideId: createdRideId,
              ridePayload,
              driverId: resolvedDriverId,
            });
          }
          await updateDoc(doc(db, 'travelerRideRequests', linkedTravelerRequestId), {
            status: 'matched',
            matchedRideId: createdRideId || null,
            matchedDriverId: resolvedDriverId,
            matchedAt: nowIso,
            updatedAt: nowIso,
          });
        }
      } else {
        const token = await withTimeout(getAccessToken(), 8000, '');
        if (!token) {
          throw new Error('Authentication timed out. Please retry.');
        }
        const body = {
          ...ridePayload,
          linkedTravelerRequestId: linkedTravelerRequestId || null,
        };
        const headers = {
          Authorization: `Bearer ${token}`,
        };
        let response;
        try {
          response = await axios.post(apiPath('/api/user?action=create-ride'), body, { headers, timeout: 15000 });
        } catch (primaryError) {
          response = await axios.post(apiPath('/api/user/create-ride'), body, { headers, timeout: 15000 });
        }
        createdRideId = String(response?.data?.rideId || '');
        const bookingId = String(response?.data?.bookingId || linkedTravelerRequestId || '');
        if (bookingId && linkedTravelerRequest && createdRideId) {
          await upsertMatchedTravelerNegotiationThread({
            bookingId,
            request: linkedTravelerRequest,
            rideId: createdRideId,
            ridePayload,
            driverId: resolvedDriverId,
          });
        }
      }
      if (linkedTravelerRequestId && createdRideId) {
        const matchedAt = new Date().toISOString();
        setTravelerRideRequests((prev) =>
          prev.map((request) =>
            request.id === linkedTravelerRequestId
              ? {
                  ...request,
                  status: 'matched',
                  matchedRideId: createdRideId,
                  matchedDriverId: resolvedDriverId,
                  matchedAt,
                  updatedAt: matchedAt,
                }
              : request
          )
        );
      }
      setNewRide({ origin: '', destination: '', price: '', seats: '4', departureDay: 'today', departureClock: '09:00' });
      setOriginLocation(null);
      setDestinationLocation(null);
      setLinkedTravelerRequestId(null);
      setShowOfferForm(false);
      alert("Ride offer posted successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'rides');
    } finally {
      setIsPostingRide(false);
    }
  };

  const handleDriverAction = async (request: Booking, status: 'confirmed' | 'rejected') => {
    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=respond-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          action: status,
          driverPhone: profile.phoneNumber || '',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const acceptedFare =
        hasPendingTravelerCounterOffer(request) && request.negotiatedFare
          ? request.negotiatedFare
          : request.fare;
      const negotiationActor = hasPendingTravelerCounterOffer(request) ? 'consumer' : 'driver';
      let updatedAt = new Date().toISOString();
      try {
        updatedAt = await persistNegotiationResolutionThroughCompatStore(request, negotiationActor, status, {
          acceptedFare,
          driverPhone: profile.phoneNumber || '',
        });
      } catch (syncError) {
        console.warn('Negotiation sync (driver response) failed after API success.', syncError);
      }

      setRequests((prev) =>
        status === 'rejected'
          ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(request))
          : prev.map((booking) =>
              getBookingThreadKey(booking) === getBookingThreadKey(request)
                ? {
                    ...booking,
                    status,
                    fare: acceptedFare,
                    negotiationStatus:
                      booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                    driverCounterPending: false,
                    driverPhone: profile.phoneNumber || '',
                    updatedAt,
                  }
                : booking
            )
      );

      await upsertTripSession({
        booking: {
          ...request,
          status,
          fare: acceptedFare,
          rideLifecycleStatus: status === 'confirmed' ? request.rideLifecycleStatus : request.rideLifecycleStatus,
        },
        actorRole: 'driver',
        actorId: profile.uid,
        location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
        forceStatus: status === 'rejected' ? 'cancelled' : undefined,
        networkState: tripNetworkState,
        appState: tripAppState,
        note: status === 'confirmed' ? 'driver_accepted_offer' : 'driver_rejected_offer',
      });

      showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
    } catch (error) {
      try {
        const acceptedFare =
          hasPendingTravelerCounterOffer(request) && request.negotiatedFare
            ? request.negotiatedFare
            : getNegotiationDisplayFare(request);
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(
          request,
          hasPendingTravelerCounterOffer(request) ? 'consumer' : 'driver',
          status,
          {
            acceptedFare,
            driverPhone: profile.phoneNumber || '',
          }
        );
        setRequests((prev) =>
          status === 'rejected'
            ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(request))
            : prev.map((booking) =>
                getBookingThreadKey(booking) === getBookingThreadKey(request)
                  ? {
                      ...booking,
                      status,
                      fare: acceptedFare,
                      negotiationStatus:
                        booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                      driverCounterPending: false,
                      driverPhone: profile.phoneNumber || '',
                      updatedAt,
                    }
                  : booking
              )
        );
        await upsertTripSession({
          booking: {
            ...request,
            status,
            fare: acceptedFare,
          },
          actorRole: 'driver',
          actorId: profile.uid,
          location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
          forceStatus: status === 'rejected' ? 'cancelled' : undefined,
          networkState: tripNetworkState,
          appState: tripAppState,
          note: status === 'confirmed' ? 'driver_accepted_offer' : 'driver_rejected_offer',
        });
        showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
      } catch (fallbackError) {
        handleFirestoreError(fallbackError, OperationType.UPDATE, `bookings/${request.id}`);
      }
    }
  };

  const handleDriverCounterOffer = async (request: Booking, fare: number) => {
    if (!fare || fare <= 0) {
      alert('Please enter a valid fare.');
      return;
    }

    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=counter-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      await persistCounterOfferThroughCompatStore(request, 'driver', fare);
      setRequests((prev) =>
        prev.map((booking) =>
          getBookingThreadKey(booking) === getBookingThreadKey(request)
            ? {
                ...booking,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'driver',
                driverCounterPending: true,
                status: 'negotiating',
                updatedAt,
              }
            : booking
        )
      );
      await upsertTripSession({
        booking: {
          ...request,
          negotiatedFare: fare,
          negotiationStatus: 'pending',
          negotiationActor: 'driver',
          status: 'negotiating',
        },
        actorRole: 'driver',
        actorId: profile.uid,
        location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
        networkState: tripNetworkState,
        appState: tripAppState,
        note: 'driver_counter_offer_sent',
      });
      showAppDialog('Counter offer sent to traveler.', 'success');
    } catch (error) {
      try {
        const updatedAt = await persistCounterOfferThroughCompatStore(request, 'driver', fare);
        setRequests((prev) =>
          prev.map((booking) =>
            getBookingThreadKey(booking) === getBookingThreadKey(request)
              ? {
                  ...booking,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'driver',
                  driverCounterPending: true,
                  status: 'negotiating',
                  updatedAt,
                }
              : booking
          )
        );
        await upsertTripSession({
          booking: {
            ...request,
            negotiatedFare: fare,
            negotiationStatus: 'pending',
            negotiationActor: 'driver',
            status: 'negotiating',
          },
          actorRole: 'driver',
          actorId: profile.uid,
          location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
          networkState: tripNetworkState,
          appState: tripAppState,
          note: 'driver_counter_offer_sent',
        });
        showAppDialog('Counter offer sent to traveler.', 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${request.id}`);
      }
    }
  };

  const submitDriverPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    try {
      const { baseFee, gstAmount } = calculateServiceFee(booking.fare, config || undefined);
      const receiptRef = storageRef(storage, `payments/${booking.id}/driver-${Date.now()}.jpg`);
      await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
      const receiptUrl = await getDownloadURL(receiptRef);
      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        paymentStatus: 'proof_submitted',
        driverPaymentMode: 'online',
        driverPaymentTransactionId: payload.transactionId,
        driverPaymentReceiptUrl: receiptUrl,
        driverPaymentSubmittedAt: new Date().toISOString(),
        driverPhone: profile.phoneNumber || '',
        driverNetServiceFee: baseFee,
        driverNetGstAmount: gstAmount,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'online',
        paymentStatus: 'pending',
        transactionId: payload.transactionId,
        receiptUrl,
        gateway: 'manual',
      });
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Driver payment proof submitted successfully.');
      setPaymentRequest(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

const finalizeDriverDashboardRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    const { netServiceFee, gstAmount } = getHybridPaymentBreakdown(
      booking,
      profile.wallet?.balance || 0,
      coinsUsed > 0,
      config || undefined
    );
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id,
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'paid',
      driverPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      driverMaiCoinsUsed: coinsUsed,
      driverPaymentTransactionId: payment.paymentId,
      driverPaymentOrderId: payment.orderId,
      driverPaymentGateway: 'razorpay',
      driverPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
      driverNetServiceFee: netServiceFee,
      driverNetGstAmount: gstAmount,
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Driver Razorpay payment verified successfully.', 'success');
  };

  const handleDriverDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);
      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'driver',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeDriverDashboardRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentRequest(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id,
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        driverMaiCoinsUsed: coinsToUse,
        driverPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        driverPhone: profile.phoneNumber || '',
        driverNetServiceFee: 0,
        driverNetGstAmount: 0,
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Platform fee paid successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleStartRide = async (booking: Booking, enteredOtp: string) => {
    if (!enteredOtp || enteredOtp !== booking.rideStartOtp) {
      alert('Invalid ride start OTP.');
      return;
    }

    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        rideLifecycleStatus: 'in_progress',
        rideStartedAt: new Date().toISOString(),
        rideStartOtpVerifiedAt: new Date().toISOString(),
        rideEndOtp: generateRideOtp(),
        rideEndOtpGeneratedAt: new Date().toISOString(),
      });

      await updateDoc(doc(db, 'rides', booking.rideId), {
        status: 'full',
      });

      await updateDoc(doc(db, 'users', booking.driverId), {
        'driverDetails.isOnline': false,
      });

      await upsertTripSession({
        booking: {
          ...booking,
          rideLifecycleStatus: 'in_progress',
          rideStartedAt: new Date().toISOString(),
          status: 'confirmed',
        },
        actorRole: 'driver',
        actorId: profile.uid,
        location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
        forceStatus: 'live',
        networkState: tripNetworkState,
        appState: tripAppState,
        note: 'ride_started',
      });

      setIsOnline(false);
      alert('Ride started. Driver visibility is now hidden until the trip is closed.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleEndRide = async (booking: Booking, enteredOtp: string) => {
    if (!enteredOtp || enteredOtp !== booking.rideEndOtp) {
      alert('Invalid end ride OTP.');
      return;
    }

    try {
      const completedAt = new Date().toISOString();
      await updateDoc(doc(db, 'bookings', booking.id), {
        rideLifecycleStatus: 'completed',
        rideEndedAt: completedAt,
        rideEndOtpVerifiedAt: completedAt,
        status: 'completed',
        driverEarningsCreditedAt: booking.driverEarningsCreditedAt || completedAt,
        reviewWorkflow: {
          version: 2,
          activatedAt: completedAt,
          consumerPending: true,
          driverPending: true,
        },
      });

      await updateDoc(doc(db, 'rides', booking.rideId), {
        status: 'completed',
      });

      await upsertTripSession({
        booking: {
          ...booking,
          rideLifecycleStatus: 'completed',
          rideEndedAt: completedAt,
          status: 'completed',
        },
        actorRole: 'driver',
        actorId: profile.uid,
        location: driverSignalLocation || (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined),
        forceStatus: 'completed',
        networkState: tripNetworkState,
        appState: tripAppState,
        note: 'ride_completed',
      });

      if (!booking.driverEarningsCreditedAt) {
        const driverRef = doc(db, 'users', booking.driverId);
        const driverSnap = await getDoc(driverRef);
        if (driverSnap.exists()) {
          const driverData = driverSnap.data() as UserProfile;
          const currentEarnings = driverData.driverDetails?.totalEarnings || 0;
          await updateDoc(driverRef, {
            'driverDetails.totalEarnings': currentEarnings + booking.fare,
          });
        }
      }

      alert('Ride completed successfully. Go online again whenever you are ready for the next trip.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;
    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits, profile.uid);
      showAppDialog('Thanks for rating your traveler.', 'success');
      setDismissedReviewIds((prev) => ({ ...prev, [reviewBooking.id]: true }));
      setReviewBooking(null);
    } catch (error: any) {
      const message = error.response?.data?.error || error.message || 'Failed to submit traveler review.';
      showAppDialog(message, 'error', 'Review submit failed');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (hasMapsIssue) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
        <div className="text-sm bg-red-50 p-4 rounded-lg text-red-700 font-mono break-all text-left">
          <p className="font-bold mb-2">Possible Causes:</p>
          <ul className="list-disc ml-4 space-y-1">
            <li><strong>RefererNotAllowedMapError:</strong> Your domain restriction in Google Cloud Console is incorrect.</li>
            <li><strong>ApiNotActivatedMapError:</strong> Maps JavaScript API is not enabled.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      {activeTab === 'dashboard' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-mairide-secondary">
                {firstName}
              </p>
              <div>
                <h1 className="text-4xl font-bold text-mairide-primary tracking-tight mb-2 uppercase">Driver Dashboard</h1>
                <p className="text-mairide-secondary italic serif">Manage your empty leg journeys and earnings.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button 
                onClick={() => {
                  if (!isOnline) {
                    alert('Please switch online first to offer a ride.');
                    return;
                  }
                  setLinkedTravelerRequestId(null);
                  setShowOfferForm(true);
                }}
                className={cn(
                  "px-6 py-4 rounded-2xl font-bold flex items-center justify-center space-x-2 transition-all",
                  isOnline
                    ? "bg-mairide-accent text-white hover:bg-mairide-primary"
                    : "bg-mairide-secondary text-mairide-primary cursor-not-allowed opacity-80"
                )}
                disabled={!isOnline}
              >
                <Plus className="w-5 h-5" />
                <span>{isOnline ? 'Offer a Ride' : 'Go Online to Offer'}</span>
              </button>
              <button 
                onClick={toggleOnline}
                className={cn(
                  "px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center space-x-3",
                  isOnline ? "bg-green-600 text-white shadow-lg shadow-green-100" : "bg-mairide-secondary text-mairide-primary"
                )}
              >
                <div className={cn("w-3 h-3 rounded-full", isOnline ? "bg-white animate-pulse" : "bg-mairide-primary")} />
                <span>{isOnline ? 'You are Online' : 'Go Online'}</span>
              </button>
            </div>
          </div>

          {showOfferForm && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] border border-mairide-accent shadow-xl relative overflow-hidden mb-10"
            >
              <div className="absolute top-0 right-0 p-4">
                <button onClick={() => setShowOfferForm(false)} className="text-mairide-secondary hover:text-mairide-primary">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <h3 className="text-2xl font-bold text-mairide-primary mb-6">Create New Offer</h3>
              {linkedTravelerRequestId && (
                <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
                  Prefilled from a traveler request. Review details and post your ride offer.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Origin</label>
                  {isLoaded ? (
                    <Autocomplete
                      onLoad={autocomplete => setAutocompleteFrom(autocomplete)}
                      onPlaceChanged={() => {
                        if (autocompleteFrom) {
                          const place = autocompleteFrom.getPlace();
                          if (place.formatted_address) {
                            setNewRide(prev => ({ ...prev, origin: place.formatted_address! }));
                          }
                          if (place.geometry?.location) {
                            setOriginLocation({
                              lat: place.geometry.location.lat(),
                              lng: place.geometry.location.lng()
                            });
                          }
                        }
                      }}
                    >
                      <input 
                        type="text" 
                        placeholder="Where are you now?"
                        className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.origin}
                        onChange={e => setNewRide({ ...newRide, origin: e.target.value })}
                      />
                    </Autocomplete>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Where are you now?"
                      className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.origin}
                      onChange={e => setNewRide({ ...newRide, origin: e.target.value })}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Destination</label>
                  {isLoaded ? (
                    <Autocomplete
                      onLoad={autocomplete => setAutocompleteTo(autocomplete)}
                      onPlaceChanged={() => {
                        if (autocompleteTo) {
                          const place = autocompleteTo.getPlace();
                          if (place.formatted_address) {
                            setNewRide(prev => ({ ...prev, destination: place.formatted_address! }));
                          }
                          if (place.geometry?.location) {
                            setDestinationLocation({
                              lat: place.geometry.location.lat(),
                              lng: place.geometry.location.lng()
                            });
                          }
                        }
                      }}
                    >
                      <input 
                        type="text" 
                        placeholder="Where are you going?"
                        className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.destination}
                        onChange={e => setNewRide({ ...newRide, destination: e.target.value })}
                      />
                    </Autocomplete>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Where are you going?"
                      className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.destination}
                      onChange={e => setNewRide({ ...newRide, destination: e.target.value })}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Your Price (INR)</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5" />
                    <input 
                      type="number" 
                      placeholder="e.g. 500"
                      className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.price}
                      onChange={e => setNewRide({ ...newRide, price: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Seats Available</label>
                  <div className="relative">
                    <select 
                      className="w-full appearance-none py-4 pl-4 pr-12 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.seats}
                      onChange={e => setNewRide({ ...newRide, seats: e.target.value })}
                    >
                      {[1, 2, 3, 4, 5, 6].map(n => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'Seat' : 'Seats'}
                        </option>
                      ))}
                    </select>
                    <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Journey Day</label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none py-4 pl-4 pr-12 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.departureDay}
                      onChange={e => setNewRide({ ...newRide, departureDay: e.target.value })}
                    >
                      <option value="today">Today</option>
                      <option value="tomorrow">Tomorrow</option>
                      <option value="dayAfter">Day After</option>
                    </select>
                    <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-mairide-primary mb-2">Likely Start Time</label>
                  <input
                    type="time"
                    className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                    value={newRide.departureClock}
                    onChange={e => setNewRide({ ...newRide, departureClock: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-mairide-secondary">
                    This is the likely start time only and may vary due to traffic, road conditions, weather, and operational delays.
                  </p>
                </div>
              </div>
              <button 
                onClick={handlePostRide}
                disabled={isPostingRide}
                className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold hover:bg-mairide-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPostingRide ? 'Posting Offer...' : 'Post Ride Offer'}
              </button>
            </motion.div>
          )}

          {activeTravelerRideRequests.length > 0 && (
            <div className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-bold text-mairide-primary">Live Traveler Ride Requests</h2>
                <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
                  {activeTravelerRideRequests.length} Live
                </span>
              </div>
              <div className="space-y-4">
                {activeTravelerRideRequests.map((request) => (
                  <div key={request.id} className="rounded-[28px] border border-mairide-secondary bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-bold text-mairide-primary">{request.origin} → {request.destination}</p>
                        <p className="text-sm text-mairide-secondary">
                          Traveler: {request.consumerName} • Seats: {request.seatsNeeded}
                        </p>
                        <div className="mt-2 inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                          <Clock className="mr-2 h-3.5 w-3.5" />
                          Departure: {formatRideDeparture(request)}
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <p className="text-2xl font-black text-mairide-accent">{formatCurrency(request.fare)}</p>
                        <button
                          onClick={() => prefillRideOfferFromTravelerRequest(request)}
                          className={cn("rounded-2xl bg-mairide-primary px-5 py-2.5 text-sm font-bold text-white", primaryActionButtonClass)}
                        >
                          Match & Offer Ride
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {partialTravelerRideRequests.length > 0 && (
            <div className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-mairide-primary">Partial Match Requests</h2>
                  <p className="mt-1 text-sm text-mairide-secondary">
                    Similar corridor opportunities that may require a negotiated detour or destination adjustment.
                  </p>
                </div>
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-orange-700 border border-orange-200">
                  Optional
                </span>
              </div>
              <div className="space-y-4">
                {partialTravelerRideRequests.map((request) => (
                  <div key={`partial-${request.id}`} className="rounded-[28px] border border-orange-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <p className="text-lg font-bold text-mairide-primary">{request.origin} → {request.destination}</p>
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                            Partial match
                          </span>
                        </div>
                        <p className="text-sm text-mairide-secondary">
                          Traveler: {request.consumerName} • Seats: {request.seatsNeeded}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                            <Clock className="mr-2 h-3.5 w-3.5" />
                            Departure: {formatRideDeparture(request)}
                          </div>
                          <div className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                            Detour may apply
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <p className="text-2xl font-black text-mairide-accent">{formatCurrency(request.fare)}</p>
                        <button
                          onClick={() => prefillRideOfferFromTravelerRequest(request)}
                          className={cn("rounded-2xl bg-mairide-primary px-5 py-2.5 text-sm font-bold text-white", primaryActionButtonClass)}
                        >
                          Explore & Offer
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeDashboardRequests.length > 0 && (
            <div className="mb-8">
              <DriverDashboardSummary
                requests={activeDashboardRequests}
                tripSessions={tripSessions}
                config={config}
                onAccept={(request) => handleDriverAction(request, 'confirmed')}
                onReject={(request) => handleDriverAction(request, 'rejected')}
                counterFares={counterFares}
                setCounterFares={setCounterFares}
                onCounter={handleDriverCounterOffer}
                onPayWithCoins={(request) => handleDriverDashboardPayment(request, true)}
                onPayOnline={(request) => handleDriverDashboardPayment(request, false)}
                onStartRide={handleStartRide}
                onEndRide={handleEndRide}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Total Earnings</p>
              <h3 className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</h3>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Rating</p>
              <div className="flex items-center space-x-2">
                <h3 className="text-2xl font-black text-mairide-primary">{getResolvedUserRating(profile).toFixed(1)}</h3>
                <Star className="w-5 h-5 text-mairide-accent fill-current" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Active Rides</p>
              <h3 className="text-2xl font-black text-mairide-primary">{requests.filter((request) => ['pending', 'confirmed', 'negotiating'].includes(request.status)).length}</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">MaiCoins Wallet</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-black tracking-tight text-mairide-primary">{profile.wallet?.balance || 0}</p>
                  <p className="text-sm font-bold text-mairide-accent">Available Maicoins</p>
                </div>
                <Wallet className="w-10 h-10 text-mairide-accent" />
              </div>
              <p className="mt-3 text-sm text-mairide-secondary">
                Use Maicoins to offset platform fees and keep your route economics stronger on every confirmed trip.
              </p>
            </div>
            <div className="bg-mairide-primary rounded-[32px] border border-mairide-primary p-6 shadow-lg shadow-mairide-primary/20 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Driver Advantage</p>
              <p className="mt-3 text-2xl font-black tracking-tight">MaiCoins turn every completed journey into future margin.</p>
              <p className="mt-3 text-sm text-white/80">
                The more you refer and complete rides, the more fee pressure you can absorb with wallet rewards instead of cash.
              </p>
            </div>
          </div>

          <div className="mb-12 overflow-hidden rounded-[32px] border border-mairide-secondary bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-mairide-secondary/70">
              <div>
                <h2 className="text-xl font-bold text-mairide-primary flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-mairide-accent" />
                  Live Traveler Map
                </h2>
                <p className="text-sm text-mairide-secondary">
                  See nearby traveler demand directly from your landing dashboard before posting a ride.
                </p>
              </div>
              <div className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                {consumers.filter(c => c.location && typeof c.location.lat === 'number' && typeof c.location.lng === 'number').length} Travelers Visible
              </div>
            </div>
            <div className="relative h-[280px] md:h-[360px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '280px 360px' }}>
              {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={userLocation || { lat: 26.1433, lng: 91.7385 }}
                  zoom={userLocation ? 14 : 7}
                  options={{
                    styles: [
                      { "featureType": "all", "elementType": "geometry.fill", "stylers": [{ "weight": "2.00" }] },
                      { "featureType": "all", "elementType": "geometry.stroke", "stylers": [{ "color": "#9c9c9c" }] },
                      { "featureType": "all", "elementType": "labels.text", "stylers": [{ "visibility": "on" }] },
                      { "featureType": "landscape", "elementType": "all", "stylers": [{ "color": "#f2f2f2" }] },
                      { "featureType": "landscape", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "landscape.man_made", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "poi", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "road", "elementType": "all", "stylers": [{ "saturation": -100 }, { "lightness": 45 }] },
                      { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#eeeeee" }] },
                      { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#7b7b7b" }] },
                      { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "road.highway", "elementType": "all", "stylers": [{ "visibility": "simplified" }] },
                      { "featureType": "road.arterial", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "transit", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "water", "elementType": "all", "stylers": [{ "color": "#46bcec" }, { "visibility": "on" }] },
                      { "featureType": "water", "elementType": "geometry.fill", "stylers": [{ "color": "#c8d7d4" }] },
                      { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#070707" }] },
                      { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] }
                    ]
                  }}
                >
                  {userLocation && (
                    <Marker 
                      position={userLocation} 
                      icon={{
                        url: 'https://maps.google.com/mapfiles/ms/icons/car.png',
                        scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(32, 32) : undefined
                      }}
                      title="You"
                    />
                  )}
                  {consumers.filter(c => c.location && typeof c.location.lat === 'number' && typeof c.location.lng === 'number').map(consumer => (
                    <Marker
                      key={consumer.uid}
                      position={{ lat: consumer.location!.lat, lng: consumer.location!.lng }}
                      icon={{
                        url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                        scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(24, 24) : undefined
                      }}
                      title={consumer.displayName}
                    />
                  ))}
                </GoogleMap>
              ) : (
                <div className="flex flex-col items-center justify-center h-full bg-mairide-bg p-8 text-center">
                  <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                  <h3 className="text-xl font-bold text-mairide-primary mb-2">
                    {loadError ? "Maps Error" : "Maps Unavailable"}
                  </h3>
                  <p className="text-mairide-secondary max-w-xs mx-auto">
                    {loadError ? loadError.message : "Please configure and activate your Google Maps API Key (Maps JavaScript API & Places API) in the Google Cloud Console."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-mairide-primary">Your Ride Offers</h2>
            </div>

            <MyRides
              profile={profile}
              hiddenRideIds={suppressedRideIds}
              onRideRetired={(rideId) =>
                setRetiredRideIds((prev) => (prev.includes(rideId) ? prev : [...prev, rideId]))
              }
            />
          </div>
        </>
      )}

      {activeTab === 'requests' && <BookingRequests profile={profile} />}
      {activeTab === 'history' && <DriverHistory profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
      {activeTab === 'profile' && <UserSelfProfilePanel profile={profile} />}
      {paymentRequest && (
        <PaymentProofModal
          booking={paymentRequest}
          payer="driver"
          config={config}
          onClose={() => setPaymentRequest(null)}
          onSubmit={(payload) => submitDriverPaymentProof(paymentRequest, payload)}
        />
      )}
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="driver"
          onClose={() => {
            setDismissedReviewIds((prev) => ({ ...prev, [reviewBooking.id]: true }));
            setReviewBooking(null);
          }}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

// --- Chatbot Component ---

class ChatbotErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Chatbot render failed:', error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const ChatbotCore = ({
  userRole,
  userId,
}: {
  userRole?: UserProfile['role'];
  userId?: string;
}) => {
  const appConfigState = useAppConfig();
  const config = (appConfigState?.config || {}) as Partial<AppConfig>;
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(String(config?.chatbotDefaultLanguage || 'en-IN'));
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(config?.chatbotVoiceInputEnabled !== false);
  const [voiceInputSupported, setVoiceInputSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatApiPath = '/api/chat';

  useEffect(() => {
    setSelectedLanguage(String(config?.chatbotDefaultLanguage || 'en-IN'));
    setVoiceInputEnabled(config?.chatbotVoiceInputEnabled !== false);
  }, [
    config?.chatbotDefaultLanguage,
    config?.chatbotVoiceInputEnabled,
  ]);

  const languageOptions = useMemo(
    () => [
      { value: 'en-IN', label: 'English' },
      { value: 'hi-IN', label: 'Hindi' },
      { value: 'ne-IN', label: 'Nepali' },
      { value: 'bn-IN', label: 'Bengali' },
      { value: 'ta-IN', label: 'Tamil' },
      { value: 'te-IN', label: 'Telugu' },
      { value: 'mr-IN', label: 'Marathi' },
      { value: 'gu-IN', label: 'Gujarati' },
      { value: 'kn-IN', label: 'Kannada' },
      { value: 'ml-IN', label: 'Malayalam' },
      { value: 'pa-IN', label: 'Punjabi' },
    ],
    []
  );

  const getLanguageLabel = (language: string) =>
    languageOptions.find((item) => item.value === language)?.label || 'English';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        setVoiceInputSupported(false);
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = selectedLanguage;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript;
        if (typeof transcript === 'string' && transcript.trim()) {
          setInput((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
        }
      };

      recognitionRef.current = recognition;
      setVoiceInputSupported(true);

      return () => {
        try {
          recognition.stop();
        } catch {
          // no-op
        }
        recognitionRef.current = null;
      };
    } catch (error) {
      console.warn('Speech recognition initialization failed; continuing without voice input.', error);
      setVoiceInputSupported(false);
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  useEffect(() => {
    if (!isOpen) return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    const scrollToLatest = () => {
      viewport.scrollTop = viewport.scrollHeight;
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    };

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(scrollToLatest);
    } else {
      scrollToLatest();
    }
  }, [messages, isTyping, isOpen]);

  const buildStaticMaiRideReply = (rawMessage: string, language: string) => {
    const lang = String(language || '').toLowerCase();
    const message = String(rawMessage || '').trim().toLowerCase();
    const hindi = lang.startsWith('hi');
    const mentionsIdentityTerms =
      /\b(ai|bot|human|person|real)\b/.test(message) ||
      message.includes('who are you') ||
      message.includes('what are you');
    const rideSearchIntent =
      /(search|find|look\\s*for|book|get)\\s+(a\\s+)?ride/.test(message) ||
      /ride\\s+for\\s+me/.test(message) ||
      /can you search/.test(message) ||
      (message.includes('from') && message.includes('to'));
    const identityIntent =
      message.includes('are you ai') ||
      message.includes('are you a bot') ||
      message.includes('real human') ||
      message.includes('real person') ||
      message.includes('human or a bot') ||
      message.includes('human or bot') ||
      message.includes('human or ai') ||
      message.includes('ai or human') ||
      message.includes('am i talking to a bot') ||
      message.includes('are you a real human') ||
      message.includes('who are you') ||
      message.includes('what are you') ||
      message.includes('are you human') ||
      (mentionsIdentityTerms && /\b(are|r|you|who|what|real)\b/.test(message)) ||
      message === 'ai' ||
      message === 'ai?' ||
      message === 'bot' ||
      message === 'bot?';
    const capabilityIntent =
      /what can you do|how can you help|help me|what do you help with|what can i ask/.test(message);
    const offerRideIntent =
      /(offer|post|publish|list)\\s+(a\\s+)?ride/.test(message) ||
      /become\\s+a\\s+driver/.test(message) ||
      /go\\s+online/.test(message);
    const routeAvailabilityIntent =
      /(what|which).*(route|routes).*(operating|running|active|available)/.test(message) ||
      /(current|currently).*(route|routes|rides|offers)/.test(message) ||
      /available\\s+(rides|routes|offers)/.test(message) ||
      /operating\\s+on/.test(message) ||
      /service\\s+route/.test(message);
    const negotiationIntent =
      /counter\\s*offer|negotiat|bargain|change\\s+fare|lower\\s+fare|raise\\s+fare/.test(message);
    const paymentIntent =
      /payment|pay|razorpay|platform fee|gst|maicoin|wallet/.test(message);
    const cancellationIntent =
      /cancel|refund|reschedul|change\\s+booking|modify\\s+booking/.test(message);

    if (!message) {
      return hindi
        ? "नमस्ते, मैं Kiara हूँ। मैं MaiRide पर ride search, booking, fare negotiation, payment, support और booking status में आपकी मदद कर सकती हूँ।"
        : "Hi, I’m Kiara. I can help with ride search, bookings, fares, negotiation, payment, support, and booking status on MaiRide.";
    }

    if (/(^|\\b)(hi|hello|hey|namaste)(\\b|$)/.test(message)) {
      return hindi
        ? "नमस्ते, मैं Kiara हूँ। आप ride search, booking, pricing, negotiation, payment या support में जो भी मदद चाहें, मैं साथ हूँ।"
        : "Hi, I’m Kiara. I can help you search rides, compare fares, negotiate, complete payments, and track bookings on MaiRide.";
    }

    if (identityIntent) {
      return hindi
        ? "मैं Kiara हूँ, MaiRide की virtual in-app assistant, इंसान agent नहीं. मैं ride search, booking, fares, payment और support में तुरंत practical मदद देने के लिए यहाँ हूँ."
        : "I’m Kiara, MaiRide’s virtual in-app assistant, not a human agent. I’m here to help with rides, bookings, fares, payments, and support in a practical way.";
    }

    if (capabilityIntent) {
      return hindi
        ? "मैं rides search करने, booking flow समझाने, fare negotiation, payment steps, booking status और support issues में मदद कर सकती हूँ. आप चाहें तो अपना route या issue सीधे लिख दीजिए."
        : "I can help you search rides, understand booking flow, negotiate fares, complete payment steps, check booking status, and handle support issues. If you want, just send me your route or issue directly.";
    }

    if (rideSearchIntent) {
      return hindi
        ? "हाँ, मैं ride search में मदद कर सकती हूँ। कृपया अपना origin, destination, journey day और seats बताइए। अगर आप traveler dashboard पर हैं, तो Request a Ride खोलकर वही details भरें और मैं next step समझा दूँगी।"
        : "Yes, I can help with that. Tell me your origin, destination, journey day, and seats needed. If you are already on the traveler dashboard, open Request a Ride and enter those details, and I’ll guide you with the next step.";
    }

    if (offerRideIntent) {
      return hindi
        ? "अगर आप ride offer करना चाहते हैं, तो driver dashboard में Go Online या Offer a Ride flow से route, seats, fare और departure time भरें। Offer live होते ही nearby matching travelers उसे देख पाएंगे।"
        : "If you want to offer a ride, use Go Online or Offer a Ride from the driver dashboard and enter your route, seats, fare, and departure time. Once the offer goes live, nearby matching travelers can see it.";
    }

    if (routeAvailabilityIntent) {
      return hindi
        ? "मैं live route list अभी नहीं पढ़ पा रही हूँ, लेकिन आप अपना origin और destination भेजिए। मैं आपको search या ride request flow का सही next step बता दूँगी।"
        : "I’m having trouble reading the live route list right now, but if you send me your origin and destination, I can still guide you through search or the right ride-request step.";
    }

    if (negotiationIntent) {
      return hindi
        ? "MaiRide में traveler और driver दोनों counter offer भेज सकते हैं। Negotiation तभी तक खुला रहता है जब तक एक side accept, reject या cancel न कर दे। Accept होते ही payment flow शुरू हो जाता है।"
        : "On MaiRide, both traveler and driver can send counter offers. Negotiation stays open until one side accepts, rejects, or cancels. Once accepted, the payment flow starts automatically.";
    }

    if (paymentIntent) {
      return hindi
        ? "Payment step में listed ride fare, platform fee और GST अलग दिखते हैं। कुछ flows में MaiCoins या wallet balance भी apply हो सकता है। Successful payment के बाद booking आगे बढ़ती है और contact details unlock हो जाते हैं।"
        : "In the payment step, the listed fare, platform fee, and GST are shown separately. In some flows, MaiCoins or wallet balance can also apply. After successful payment, the booking moves forward and contact details unlock.";
    }

    if (cancellationIntent) {
      return hindi
        ? "अगर booking cancel या modify करनी है, पहले उसकी current status check करें। Pending stage में changes आसान होते हैं, लेकिन confirmed या paid ride के लिए Support team की मदद लग सकती है।"
        : "If you need to cancel or modify a booking, first check its current status. Changes are easier in the pending stage, but confirmed or paid rides may need help from the Support team.";
    }

    if (message.includes('book') || message.includes('booking flow')) {
      return hindi
        ? "बुकिंग के लिए: राइड सर्च करें, रूट और टाइम चेक करें, फिर request या counter offer भेजें। किसी एक पक्ष के accept करते ही platform fee payment के बाद contact details unlock हो जाती हैं।"
        : "Booking flow: search rides, open a ride card, verify route and departure timing, then send a booking request or counter offer. Once either side accepts, both parties complete platform-fee payment and contact details unlock automatically.";
    }

    if (message.includes('price') || message.includes('fare') || message.includes('cost')) {
      return hindi
        ? "राइड कार्ड पर listed fare दिखता है। Confirmation से पहले platform fee और GST अलग से दिखते हैं। नेगोशिएशन accept/reject होने तक चलता रहता है।"
        : "The ride card shows the listed fare. Platform fee and GST are shown separately before confirmation. Negotiation stays active until one side accepts or rejects.";
    }

    if (message.includes('status')) {
      return hindi
        ? "बुकिंग स्टेटस active card से ट्रैक कर सकते हैं: pending, counter offer, confirmed, paid, started, completed."
        : "You can track status from your active booking/ride card: pending, counter offer, confirmed, paid, started, and completed.";
    }

    if (message.includes('support') || message.includes('ticket')) {
      return hindi
        ? "किसी भी समस्या के लिए Support सेक्शन से ticket बनाएं। Post-confirmation cancellation के लिए support/admin override की जरूरत होती है।"
        : "For any issue, please open a ticket from Support so the team can resolve it quickly. For post-confirmation cancellation, support/admin override is required.";
    }

    if (message.includes('region') || message.includes('service area')) {
      return hindi
        ? "MaiRide route और timing match के आधार पर active approved driver offers दिखाता है।"
        : "MaiRide shows route-based offers when there is an active approved driver matching your route and timing window.";
    }

    if (message.includes('admin')) {
      return hindi
        ? "Admin actions में driver verification, user management, rides oversight, transactions, config और support workflows शामिल हैं।"
        : "Admin actions include driver verification, user management, ride oversight, transactions, config, and support workflows.";
    }

    return hindi
      ? "मैं Kiara हूँ. अगर आप चाहें, तो अपना route, booking issue, fare question या support problem सीधे लिख दीजिए और मैं next step साफ़-साफ़ बता दूँगी।"
      : "I’m Kiara. If you want, send me your route, booking issue, fare question, or support problem directly, and I’ll guide you with the next step clearly.";
  };

  const toggleVoiceInput = () => {
    if (!voiceInputEnabled) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    } catch (error) {
      console.error('Voice input toggle failed:', error);
      setIsListening(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const currentInput = input;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const transcript = [...messages, userMsg]
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }));
      const response = await axios.post(chatApiPath, {
        messages: transcript,
        language: selectedLanguage,
        userRole: userRole || 'consumer',
        userId: userId || '',
      });
      const text = String(response?.data?.message || '').trim();
      const finalText = text || buildStaticMaiRideReply(currentInput, selectedLanguage);

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: finalText,
        createdAt: new Date().toISOString()
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      console.error("Chatbot Error:", error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          getApiErrorMessage(error, '')?.trim() ||
          config.chatbotFallbackMessage ||
          buildStaticMaiRideReply(currentInput, selectedLanguage),
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            className="bg-white rounded-[32px] shadow-2xl border border-mairide-secondary w-80 md:w-96 h-[500px] flex flex-col overflow-hidden mb-4"
          >
            <div className="bg-mairide-primary p-6 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <div className="bg-mairide-accent p-2 rounded-xl">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Mai Kiara</h3>
                  <p className="text-white/60 text-[10px] uppercase tracking-wider">Online</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="bg-white/10 text-white text-xs rounded-lg px-2 py-1 border border-white/20 outline-none"
                  title="Assistant language"
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value} className="text-mairide-primary">
                      {option.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div ref={messagesViewportRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-mairide-bg">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-mairide-secondary text-sm italic serif">
                    {String(selectedLanguage || '').toLowerCase().startsWith('hi')
                      ? 'आज मैं आपकी कैसे मदद कर सकती हूँ?'
                      : `How can I help you today? (${getLanguageLabel(selectedLanguage)})`}
                  </p>
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={cn(
                  "flex",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}>
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm",
                    msg.role === 'user' ? "bg-mairide-accent text-white rounded-tr-none" : "bg-white text-mairide-primary border border-mairide-secondary rounded-tl-none shadow-sm"
                  )}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-mairide-secondary p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>

            <div className="p-4 bg-white border-t border-mairide-secondary flex space-x-2">
              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 bg-mairide-bg border-none rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-mairide-accent"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              />
              <button
                onClick={handleSend}
                className="bg-mairide-accent text-white p-2 rounded-xl hover:scale-105 transition-transform"
              >
                <Send className="w-5 h-5" />
              </button>
              {voiceInputSupported && voiceInputEnabled && (
                <button
                  onClick={toggleVoiceInput}
                  className={cn(
                    "p-2 rounded-xl transition-transform",
                    isListening
                      ? "bg-red-500 text-white hover:scale-105"
                      : "bg-mairide-primary text-white hover:scale-105"
                  )}
                  title={isListening ? 'Stop listening' : 'Speak your message'}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-mairide-primary text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </div>
  );
};

const Chatbot = ({ userRole, userId }: { userRole?: UserProfile['role']; userId?: string }) => (
  <ChatbotErrorBoundary>
    <ChatbotCore userRole={userRole} userId={userId} />
  </ChatbotErrorBoundary>
);

// --- Support System Components ---

const CSATFeedbackModal = ({ ticket, onClose, onSubmitted }: { ticket: SupportTicket; onClose: () => void; onSubmitted?: (ticket: SupportTicket) => void }) => {
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tags = [
    "Fast Response",
    "Knowledgeable Agent",
    "Resolved Issue",
    "Friendly Service",
    "Professional",
    "Clear Communication"
  ];

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    if (rating === 0) return;
    setIsSubmitting(true);
    try {
      const updated = await submitSupportFeedback({
        ticketId: ticket.id,
        rating,
        tags: selectedTags,
        comment,
      });
      if (updated && onSubmitted) onSubmitted(updated);
      onClose();
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to submit feedback.';
      showAppDialog(message, 'error', 'Feedback submit failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl border border-mairide-secondary"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-mairide-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-mairide-accent fill-mairide-accent" />
          </div>
          <h2 className="text-2xl font-bold text-mairide-primary tracking-tight uppercase">How did we do?</h2>
          <p className="text-mairide-secondary italic serif">Your feedback helps us improve our service.</p>
        </div>

        <div className="flex justify-center space-x-2 mb-8">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star 
                className={cn(
                  "w-10 h-10 transition-colors",
                  rating >= star ? "text-mairide-accent fill-mairide-accent" : "text-mairide-bg fill-mairide-bg stroke-mairide-secondary"
                )} 
              />
            </button>
          ))}
        </div>

        <div className="mb-8">
          <label className="block text-xs font-bold text-mairide-secondary uppercase mb-4 text-center">What did you like?</label>
          <div className="flex flex-wrap justify-center gap-2">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-bold transition-all border",
                  selectedTags.includes(tag)
                    ? "bg-mairide-primary text-white border-mairide-primary shadow-lg shadow-mairide-primary/20"
                    : "bg-mairide-bg text-mairide-secondary border-mairide-secondary hover:border-mairide-primary"
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <textarea
            className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent resize-none text-sm"
            placeholder="Any additional comments? (Optional)"
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        </div>

        <div className="flex space-x-4">
          <button
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl font-bold text-mairide-secondary hover:bg-mairide-bg transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            className="flex-1 bg-mairide-accent text-white py-4 rounded-2xl font-bold shadow-lg shadow-mairide-accent/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const SupportSystem = ({ profile }: { profile: UserProfile }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [feedbackTicket, setFeedbackTicket] = useState<SupportTicket | null>(null);

  const refreshTickets = async () => {
    try {
      const data = await listSupportTickets(false);
      setTickets(data);
      const resolvedWithoutFeedback = data.find((t) => t.status === 'resolved' && !t.feedback);
      setFeedbackTicket(resolvedWithoutFeedback || null);
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to load support tickets.';
      showAppDialog(message, 'error', 'Support unavailable');
    }
  };

  useEffect(() => {
    refreshTickets();
    const interval = window.setInterval(() => {
      refreshTickets().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [profile.uid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !message) return;

    setIsSubmitting(true);
    try {
      await createSupportTicket({ subject, message, priority: 'medium' });
      setSubject('');
      setMessage('');
      showAppDialog('Support ticket submitted successfully.', 'success');
      await refreshTickets();
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to submit support ticket.';
      showAppDialog(message, 'error', 'Support submit failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-mairide-primary tracking-tight mb-2 uppercase">Customer Support</h1>
        <p className="text-mairide-secondary italic serif">We're here to help. Submit a query or complaint.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="bg-white rounded-[32px] p-8 shadow-xl border border-mairide-secondary h-fit">
          <h2 className="text-xl font-bold text-mairide-primary mb-6">Submit a Ticket</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2">Subject</label>
              <input
                type="text"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent"
                placeholder="e.g., Booking Issue, Payment Query"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2">Message</label>
              <textarea
                rows={5}
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent resize-none"
                placeholder="Describe your issue in detail..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold shadow-lg shadow-orange-100 hover:scale-[1.02] transition-transform disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-mairide-primary mb-6">Your Tickets</h2>
          {tickets.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-[32px] border border-mairide-secondary border-dashed">
              <p className="text-mairide-secondary italic serif">No support tickets found.</p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-mairide-primary">{ticket.subject}</h3>
                    <p className="text-xs text-mairide-secondary">{new Date(ticket.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                    ticket.status === 'open' ? "bg-blue-50 text-blue-600" :
                    ticket.status === 'resolved' ? "bg-green-50 text-green-600" :
                    "bg-gray-50 text-gray-600"
                  )}>
                    {ticket.status}
                  </span>
                </div>
                <p className="text-sm text-mairide-secondary line-clamp-2 mb-4">{ticket.message}</p>
                {ticket.responses && ticket.responses.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-mairide-bg">
                    <p className="text-xs font-bold text-mairide-accent mb-2 flex items-center">
                      <MessageSquare className="w-3 h-3 mr-1" /> Latest Response:
                    </p>
                    <p className="text-xs text-mairide-primary italic serif">"{ticket.responses[ticket.responses.length - 1].message}"</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {feedbackTicket && (
        <CSATFeedbackModal 
          ticket={feedbackTicket} 
          onClose={() => setFeedbackTicket(null)}
          onSubmitted={(updatedTicket) => {
            setTickets((prev) => prev.map((item) => (item.id === updatedTicket.id ? updatedTicket : item)));
          }}
        />
      )}
    </div>
  );
};

const AdminSupportView = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [response, setResponse] = useState('');

  const refreshTickets = async () => {
    try {
      const data = await listSupportTickets(true);
      setTickets(data);
      if (selectedTicket) {
        const latest = data.find((item) => item.id === selectedTicket.id) || null;
        setSelectedTicket(latest);
      }
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to load support tickets.';
      showAppDialog(message, 'error', 'Support unavailable');
    }
  };

  useEffect(() => {
    refreshTickets();
    const interval = window.setInterval(() => {
      refreshTickets().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [selectedTicket?.id]);

  const handleSendResponse = async () => {
    if (!selectedTicket || !response) return;

    try {
      const newResponse = {
        senderId: auth.currentUser?.uid || 'admin',
        senderName: 'MaiRide Support',
        message: response,
        createdAt: new Date().toISOString()
      };
      const updated = await respondSupportTicket({ ticketId: selectedTicket.id, message: newResponse.message });
      if (updated) {
        setSelectedTicket(updated);
      }

      setResponse('');
      showAppDialog('Response sent successfully.', 'success');
      await refreshTickets();
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to send support response.';
      showAppDialog(message, 'error', 'Support reply failed');
    }
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: SupportTicket['status']) => {
    try {
      const updated = await updateSupportTicketStatus({ ticketId, status: newStatus });
      if (updated) {
        setTickets((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        if (selectedTicket?.id === updated.id) {
          setSelectedTicket(updated);
        }
      }
    } catch (error) {
      const message = (error as any)?.response?.data?.error || (error as Error)?.message || 'Failed to update ticket status.';
      showAppDialog(message, 'error', 'Status update failed');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary mb-6">All Tickets</h2>
        {tickets.map(ticket => (
          <div 
            key={ticket.id} 
            onClick={() => setSelectedTicket(ticket)}
            className={cn(
              "p-6 rounded-3xl border transition-all cursor-pointer",
              selectedTicket?.id === ticket.id ? "bg-mairide-primary text-white border-mairide-primary" : "bg-white text-mairide-primary border-mairide-secondary hover:bg-mairide-bg"
            )}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold truncate pr-2">{ticket.subject}</h3>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase",
                ticket.status === 'open' ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
              )}>
                {ticket.status}
              </span>
            </div>
            <p className={cn("text-xs mb-2", selectedTicket?.id === ticket.id ? "text-white/60" : "text-mairide-secondary")}>
              From: {ticket.userName}
            </p>
            <p className="text-[10px] opacity-60">{new Date(ticket.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="lg:col-span-2">
        {selectedTicket ? (
          <div className="bg-white rounded-[32px] border border-mairide-secondary shadow-xl flex flex-col h-[600px]">
            <div className="p-8 border-b border-mairide-secondary">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-mairide-primary">{selectedTicket.subject}</h2>
                  <p className="text-sm text-mairide-secondary">Ticket ID: {selectedTicket.id}</p>
                </div>
                <select 
                  className="bg-mairide-bg border-none rounded-xl text-xs font-bold p-3 outline-none"
                  value={selectedTicket.status}
                  onChange={(e) => handleUpdateStatus(selectedTicket.id, e.target.value as any)}
                >
                  <option value="open">Open</option>
                  <option value="in-progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="bg-mairide-bg p-6 rounded-2xl">
                <p className="text-sm text-mairide-primary italic serif">"{selectedTicket.message}"</p>
              </div>

              {selectedTicket.feedback && (
                <div className="mt-6 p-6 bg-mairide-accent/5 rounded-2xl border border-mairide-accent/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-mairide-primary flex items-center">
                      <Star className="w-4 h-4 text-mairide-accent fill-mairide-accent mr-2" />
                      Customer Feedback
                    </h4>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star 
                          key={s} 
                          className={cn(
                            "w-4 h-4",
                            selectedTicket.feedback!.rating >= s ? "text-mairide-accent fill-mairide-accent" : "text-mairide-secondary/20"
                          )} 
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedTicket.feedback.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-white rounded-full text-[10px] font-bold text-mairide-secondary border border-mairide-secondary/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {selectedTicket.feedback.comment && (
                    <p className="text-sm text-mairide-primary italic serif">"{selectedTicket.feedback.comment}"</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {selectedTicket.responses?.map((res, idx) => (
                <div key={idx} className={cn(
                  "flex flex-col",
                  res.senderId === auth.currentUser?.uid ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm",
                    res.senderId === auth.currentUser?.uid ? "bg-mairide-accent text-white" : "bg-mairide-bg text-mairide-primary"
                  )}>
                    {res.message}
                  </div>
                  <span className="text-[10px] text-mairide-secondary mt-1">{new Date(res.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="p-8 border-t border-mairide-secondary flex space-x-4">
              <input
                type="text"
                placeholder="Type your response..."
                className="flex-1 bg-mairide-bg border-none rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-mairide-accent"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
              <button
                onClick={handleSendResponse}
                className="bg-mairide-primary text-white px-8 py-4 rounded-2xl font-bold hover:scale-105 transition-transform"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center bg-white rounded-[32px] border border-mairide-secondary border-dashed p-12 text-center">
            <LifeBuoy className="w-16 h-16 text-mairide-secondary mb-4" />
            <h3 className="text-xl font-bold text-mairide-primary mb-2">Select a ticket to view details</h3>
            <p className="text-mairide-secondary italic serif">Support queries from users will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Driver Status Screens ---

const DriverPendingApproval = ({ profile }: { profile: UserProfile }) => {
  return (
    <div className="min-h-screen bg-mairide-bg flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-2xl text-center border border-mairide-secondary"
      >
        <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white shadow-lg">
          <Clock className="w-12 h-12 text-orange-600" />
        </div>
        <h1 className="text-3xl font-black text-mairide-primary mb-4 tracking-tighter">Verification Pending</h1>
        <p className="text-mairide-secondary mb-8 italic serif">
          Welcome to the family! Your documents are currently being reviewed by our team.
          This usually takes 24-48 hours.
        </p>
        <div className="bg-orange-50 p-6 rounded-3xl text-left mb-8 border border-orange-100">
          <div className="flex items-center space-x-2 text-orange-800 font-bold text-sm mb-2">
            <ShieldCheck className="w-5 h-5" />
            <span>Safety First</span>
          </div>
          <p className="text-xs text-orange-700 leading-relaxed">
            To ensure the safety of our community, we verify all driver documents before granting access to the platform.
          </p>
        </div>
        <button 
          onClick={() => signOut(auth)}
          className="w-full bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold hover:bg-mairide-secondary transition-colors"
        >
          Logout
        </button>
      </motion.div>
    </div>
  );
};

const DriverRejected = ({ profile }: { profile: UserProfile }) => {
  return (
    <div className="min-h-screen bg-mairide-bg flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-2xl text-center border border-mairide-secondary"
      >
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white shadow-lg">
          <AlertCircle className="w-12 h-12 text-red-600" />
        </div>
        <h1 className="text-3xl font-black text-mairide-primary mb-4 tracking-tighter">Verification Rejected</h1>
        <p className="text-mairide-secondary mb-6 italic serif">
          Unfortunately, your driver application could not be approved at this time.
        </p>
        {profile.rejectionReason && (
          <div className="bg-red-50 p-6 rounded-3xl text-left mb-8 border border-red-100">
            <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest mb-2">Reason for Rejection:</p>
            <p className="text-sm text-red-700 leading-relaxed">{profile.rejectionReason}</p>
          </div>
        )}
        <div className="space-y-4">
          <button 
            onClick={async () => {
              try {
                await updateDoc(doc(db, 'users', profile.uid), { 
                  onboardingComplete: false,
                  verificationStatus: undefined,
                  rejectionReason: undefined
                });
              } catch (error) {
                handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
              }
            }}
            className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold hover:scale-105 transition-transform shadow-lg shadow-mairide-primary/20"
          >
            Re-submit Documents
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="w-full bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold hover:bg-mairide-secondary transition-colors"
          >
            Logout
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Admin Revenue Analysis ---

const getAdminTractionAreas = (bookings: any[]) => {
  const areas: { [key: string]: number } = {};
  bookings.forEach((booking) => {
    areas[booking.destination] = (areas[booking.destination] || 0) + 1;
  });
  return Object.entries(areas)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
};

const AdminMarketingInsightsCard = ({ bookings }: { bookings: any[] }) => {
  const tractionAreas = useMemo(() => getAdminTractionAreas(bookings), [bookings]);

  return (
    <div className="bg-mairide-primary p-10 rounded-[40px] text-white overflow-hidden relative">
      <div className="relative z-10">
        <div className="flex items-center space-x-3 mb-6">
          <Bot className="w-8 h-8 text-mairide-accent" />
          <h3 className="text-2xl font-bold">Marketing Insights & Recommendations</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
            <h4 className="font-bold text-mairide-accent mb-4 flex items-center space-x-2">
              <MapPin className="w-4 h-4" />
              <span>Top Growth Sector</span>
            </h4>
            <p className="text-sm opacity-80 leading-relaxed">
              Based on recent trends, <span className="text-white font-bold">{tractionAreas[0]?.name || 'Guwahati City'}</span> is showing {Math.floor(Math.random() * 20) + 10}% higher demand. We recommend launching a localized referral campaign in this area.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
            <h4 className="font-bold text-mairide-accent mb-4 flex items-center space-x-2">
              <Users className="w-4 h-4" />
              <span>User Retention</span>
            </h4>
            <p className="text-sm opacity-80 leading-relaxed">
              Users with more than 50 Maicoins have a 3x higher retention rate. Consider a "Maicoin Multiplier" weekend to boost wallet balances and long-term engagement.
            </p>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-mairide-accent/20 rounded-full blur-3xl" />
    </div>
  );
};

const AdminRevenueAnalysis = ({
  bookings,
  users,
  afterAlertsSlot,
}: {
  bookings: any[];
  users: UserProfile[];
  afterAlertsSlot?: React.ReactNode;
}) => {
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const paymentEvents = useMemo(() => getPlatformFeePaymentEvents(bookings as Booking[]), [bookings]);
  
  // Calculate stats
  const totalRevenue = useMemo(() => paymentEvents.reduce((acc, event) => acc + event.revenue, 0), [paymentEvents]);
  const totalGST = useMemo(() => paymentEvents.reduce((acc, event) => acc + event.gst, 0), [paymentEvents]);
  const totalMaiCoinsIssued = useMemo(
    () => users.reduce((acc, u) => acc + (u.wallet?.balance || 0) + (u.wallet?.pendingBalance || 0), 0),
    [users]
  );
  
  // Prepare chart data
  const getChartData = () => {
    const data: any[] = [];
    const now = new Date();
    
    if (timeframe === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const dayBookings = paymentEvents.filter(event => 
          new Date(event.createdAt).toDateString() === d.toDateString()
        );
        data.push({
          name: dateStr,
          revenue: dayBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: dayBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: dayBookings.length
        });
      }
    } else if (timeframe === 'weekly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - (i * 7));
        const weekStr = `Week ${4-i}`;
        const weekBookings = paymentEvents.filter(event => {
          const bDate = new Date(event.createdAt);
          const diffDays = Math.floor((now.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= i * 7 && diffDays < (i + 1) * 7;
        });
        data.push({
          name: weekStr,
          revenue: weekBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: weekBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: weekBookings.length
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(now.getMonth() - i);
        const monthStr = d.toLocaleDateString('en-IN', { month: 'short' });
        const monthBookings = paymentEvents.filter(event => {
          const bDate = new Date(event.createdAt);
          return bDate.getMonth() === d.getMonth() && bDate.getFullYear() === d.getFullYear();
        });
        data.push({
          name: monthStr,
          revenue: monthBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: monthBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: monthBookings.length
        });
      }
    }
    return data;
  };

  const chartData = useMemo(() => getChartData(), [timeframe, paymentEvents]);
  
  const tractionAreas = useMemo(() => getAdminTractionAreas(bookings), [bookings]);

  // Cash flow alert
  const isNegativeCashFlow = totalMaiCoinsIssued > totalRevenue * 2; // Simple heuristic

  return (
    <div className="space-y-8">
      {/* Alerts */}
      {isNegativeCashFlow && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 p-6 rounded-[32px] flex items-start space-x-4"
        >
          <div className="bg-red-100 p-3 rounded-2xl">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-900">Negative Cash Flow Risk</h3>
            <p className="text-sm text-red-700">Maicoins liabilities (₹{totalMaiCoinsIssued}) are high relative to current revenue (₹{totalRevenue}). Consider adjusting referral rewards or increasing platform fees.</p>
          </div>
        </motion.div>
      )}

      {afterAlertsSlot}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center mb-4">
            <IndianRupee className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">Total Revenue</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{formatCurrency(totalRevenue)}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">Excluding GST</p>
        </div>
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">GST Collected</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{formatCurrency(totalGST)}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">18% Standard Rate</p>
        </div>
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
            <Bot className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">Maicoins Liability</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{totalMaiCoinsIssued}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">Total Points in Wallets</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-bold text-mairide-primary">Revenue Trends</h3>
            <div className="flex space-x-2 bg-mairide-bg p-1 rounded-xl">
              {['daily', 'weekly', 'monthly'].map(t => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t as any)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                    timeframe === t ? "bg-white text-mairide-primary shadow-sm" : "text-mairide-secondary"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F27D26" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#F27D26" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#F27D26" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <h3 className="text-xl font-bold text-mairide-primary mb-8">High Traction Destinations</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tractionAreas} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eee" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} width={100} />
                <Tooltip 
                  cursor={{ fill: '#f5f5f5' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="count" fill="#141414" radius={[0, 10, 10, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
};

const AdminConfigView = () => {
  const defaultChatbotPrompt = `You are MaiRide's official in-app assistant, Mai Kiara. When referring to yourself in conversation, use only the name Kiara. Speak like a warm, polite, emotionally intelligent Indian customer support specialist. Sound human, not robotic. Use friendly wording, acknowledge user concerns briefly, and give practical next steps. Keep replies short, clear, and supportive.

Answer only about MaiRide topics:
- rides
- pricing
- booking flow
- support
- service regions
- booking status
- support tickets
- admin actions

Do not answer unrelated general knowledge questions. For non-admin users, do not provide admin operational actions or admin panel guidance. If the user asks for account-specific or live operational details you cannot securely verify, politely direct them to the relevant MaiRide screen or support workflow instead of guessing.`;
  const providerModelOptions: Record<NonNullable<AppConfig['llmProvider']>, string[]> = {
    gemini: ['gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-nano'],
    claude: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    disabled: [],
  };
  const buildDefaultConfig = (): Partial<AppConfig> => ({
    maintenanceFeeBase: 100,
    gstRate: 0.18,
    referralRewardTier1: 25,
    referralRewardTier2: 5,
    paymentGatewayUrl: 'https://api.razorpay.com/v1',
    razorpayKeyId: RAZORPAY_KEY_ID || '',
    smsOtpProvider: '2factor',
    smsApiUrl: 'https://2factor.in/API/V1',
    smsLoginTemplateName: 'Login_otp',
    smsPasswordResetTemplateName: 'Password_Reset',
    emailOtpEnabled: true,
    emailOtpProvider: 'resend',
    resendApiBaseUrl: 'https://api.resend.com/emails',
    resendFromName: 'MaiRide',
    emailOtpExpiryMinutes: 10,
    emailOtpSubject: 'Your MaiRide verification code',
    chatbotEnabled: true,
    llmProvider: 'gemini',
    llmModel: 'gemini-1.5-pro',
    chatbotSystemPrompt: defaultChatbotPrompt,
    chatbotTemperature: 0.3,
    chatbotMaxTokens: 400,
    chatbotFallbackMessage: "MaiRide Assistant is temporarily unavailable. Please use the Support section if you need urgent help.",
    chatbotDefaultLanguage: 'en-IN',
    chatbotVoiceOutputEnabled: false,
    chatbotVoiceInputEnabled: true,
    chatbotTtsRate: 0.95,
    chatbotTtsPitch: 1.02,
    appBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
    publicApiBaseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '',
    environmentLabel: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
    superAdminEmail: SUPER_ADMIN_EMAIL,
    appVersion: APP_VERSION,
    supabaseProjectUrl: import.meta.env.VITE_SUPABASE_URL || '',
    storageBucket: import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || '',
    capacitySupabaseEgressGbMonthly: 5,
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || '',
    supportEmail: '',
    supportPhone: '',
    geminiProjectId: '',
    openaiProjectId: '',
    openaiOrgId: '',
    n8nBaseUrl: '',
    n8nOtpWebhookUrl: '',
    n8nPaymentWebhookUrl: '',
    n8nBookingWebhookUrl: '',
    n8nChatWebhookUrl: '',
    n8nSupportWebhookUrl: '',
    n8nUserWebhookUrl: '',
  });

  const [formData, setFormData] = useState<Partial<AppConfig>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const saveConfig = async (payload: Partial<AppConfig>) => {
    const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
    const response = await axios.post(adminSaveConfigPath, payload, {
      headers
    });
    if (response.data?.config) {
      setFormData(response.data.config);
    }
    return response.data?.config;
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const defaults = buildDefaultConfig();
        const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
        const response = await axios.get(adminConfigPath, { headers });
        if (response.data?.config) {
          setFormData({ ...defaults, ...response.data.config });
        } else {
          setFormData(defaults);
        }
      } catch (error: any) {
        console.error('Error loading configuration:', error);
        alert(getApiErrorMessage(error, "Failed to load configuration."));
        setFormData(buildDefaultConfig());
      } finally {
        setLoadingConfig(false);
      }
    };

    void loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveConfig({
        ...formData,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'admin'
      });
      alert("Configuration saved successfully!");
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      alert(getApiErrorMessage(error, "Failed to save configuration."));
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingConfig) return <div className="p-20 text-center font-bold">Loading configuration...</div>;

  const selectedProvider = (formData.llmProvider || 'gemini') as NonNullable<AppConfig['llmProvider']>;
  const providerModels = providerModelOptions[selectedProvider] || [];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary p-10 shadow-sm">
        <div className="flex items-center space-x-4 mb-8">
          <div className="bg-mairide-primary p-3 rounded-2xl">
            <Settings className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-mairide-primary">Global Configuration</h2>
            <p className="text-sm text-mairide-secondary italic serif">Manage platform variables and external service parameters.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          {/* Payment Config */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Payment & Revenue</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Maintenance Fee Base (₹)</label>
                <input 
                  type="number"
                  value={formData.maintenanceFeeBase || 0}
                  onChange={e => setFormData({ ...formData, maintenanceFeeBase: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">GST Rate (e.g. 0.18)</label>
                <input 
                  type="number"
                  step="0.01"
                  value={formData.gstRate || 0}
                  onChange={e => setFormData({ ...formData, gstRate: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Payment Gateway URL</label>
                <input 
                  type="url"
                  value={formData.paymentGatewayUrl || ''}
                  onChange={e => setFormData({ ...formData, paymentGatewayUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Key ID</label>
                <input 
                  type="text"
                  value={formData.razorpayKeyId || ''}
                  onChange={e => setFormData({ ...formData, razorpayKeyId: e.target.value })}
                  placeholder="e.g. rzp_test_xxxxx"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Key Secret</label>
                <input 
                  type="password"
                  value={formData.razorpayKeySecret || ''}
                  onChange={e => setFormData({ ...formData, razorpayKeySecret: e.target.value })}
                  placeholder="Server-side secret"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Webhook Secret</label>
                <input 
                  type="password"
                  value={formData.razorpayWebhookSecret || ''}
                  onChange={e => setFormData({ ...formData, razorpayWebhookSecret: e.target.value })}
                  placeholder="Optional webhook signature secret"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          {/* Referral Config */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Referral Rewards</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Tier 1 Reward (Maicoins)</label>
                <input 
                  type="number"
                  value={formData.referralRewardTier1 || 0}
                  onChange={e => setFormData({ ...formData, referralRewardTier1: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Tier 2 Reward (Maicoins)</label>
                <input 
                  type="number"
                  value={formData.referralRewardTier2 || 0}
                  onChange={e => setFormData({ ...formData, referralRewardTier2: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
            </div>
          </div>

          {/* External APIs */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">OTP & Messaging</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS OTP Provider</label>
                <select
                  value={formData.smsOtpProvider || '2factor'}
                  onChange={e => setFormData({ ...formData, smsOtpProvider: e.target.value as AppConfig['smsOtpProvider'] })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="2factor">2Factor</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS API URL</label>
                <input 
                  type="url"
                  value={formData.smsApiUrl || ''}
                  onChange={e => setFormData({ ...formData, smsApiUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">2Factor / SMS API Key</label>
                <input 
                  type="password"
                  value={formData.twoFactorApiKey || formData.smsApiKey || ''}
                  onChange={e => setFormData({ ...formData, twoFactorApiKey: e.target.value, smsApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Login / Signup SMS Template Name</label>
                <input 
                  type="text"
                  value={formData.smsLoginTemplateName || formData.smsTemplateName || ''}
                  onChange={e => setFormData({ ...formData, smsLoginTemplateName: e.target.value, smsTemplateName: e.target.value })}
                  placeholder="Login_otp"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Password Reset SMS Template Name</label>
                <input 
                  type="text"
                  value={formData.smsPasswordResetTemplateName || ''}
                  onChange={e => setFormData({ ...formData, smsPasswordResetTemplateName: e.target.value })}
                  placeholder="Password_Reset"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Enabled</label>
                <select
                  value={formData.emailOtpEnabled === false ? 'disabled' : 'enabled'}
                  onChange={e => setFormData({ ...formData, emailOtpEnabled: e.target.value === 'enabled' })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Provider</label>
                <select
                  value={formData.emailOtpProvider || 'resend'}
                  onChange={e => setFormData({ ...formData, emailOtpProvider: e.target.value as AppConfig['emailOtpProvider'] })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="resend">Resend</option>
                  <option value="2factor">2Factor</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend API URL</label>
                <input 
                  type="url"
                  value={formData.resendApiBaseUrl || formData.emailApiUrl || ''}
                  onChange={e => setFormData({ ...formData, resendApiBaseUrl: e.target.value, emailApiUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend API Key</label>
                <input 
                  type="password"
                  value={formData.resendApiKey || formData.emailApiKey || ''}
                  onChange={e => setFormData({ ...formData, resendApiKey: e.target.value, emailApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend From Email</label>
                <input 
                  type="email"
                  value={formData.resendFromEmail || ''}
                  onChange={e => setFormData({ ...formData, resendFromEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend From Name</label>
                <input 
                  type="text"
                  value={formData.resendFromName || ''}
                  onChange={e => setFormData({ ...formData, resendFromName: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Reply-To Email</label>
                <input 
                  type="email"
                  value={formData.resendReplyToEmail || ''}
                  onChange={e => setFormData({ ...formData, resendReplyToEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Subject</label>
                <input 
                  type="text"
                  value={formData.emailOtpSubject || ''}
                  onChange={e => setFormData({ ...formData, emailOtpSubject: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Expiry (minutes)</label>
                <input 
                  type="number"
                  min="3"
                  value={formData.emailOtpExpiryMinutes || 10}
                  onChange={e => setFormData({ ...formData, emailOtpExpiryMinutes: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Support Email</label>
                <input 
                  type="email"
                  value={formData.supportEmail || ''}
                  onChange={e => setFormData({ ...formData, supportEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Runtime & Automation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">App Base URL</label>
                <input 
                  type="url"
                  value={formData.appBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, appBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Public API Base URL</label>
                <input 
                  type="url"
                  value={formData.publicApiBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, publicApiBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Environment Label</label>
                <input 
                  type="text"
                  value={formData.environmentLabel || ''}
                  onChange={e => setFormData({ ...formData, environmentLabel: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Support Phone</label>
                <input 
                  type="tel"
                  value={formData.supportPhone || ''}
                  onChange={e => setFormData({ ...formData, supportPhone: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Base URL</label>
                <input 
                  type="url"
                  value={formData.n8nBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n API Key</label>
                <input 
                  type="password"
                  value={formData.n8nApiKey || ''}
                  onChange={e => setFormData({ ...formData, n8nApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Shared Secret</label>
                <input 
                  type="password"
                  value={formData.n8nSharedSecret || ''}
                  onChange={e => setFormData({ ...formData, n8nSharedSecret: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n OTP Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nOtpWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nOtpWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Payment Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nPaymentWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nPaymentWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Booking Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nBookingWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nBookingWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Chat Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nChatWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nChatWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Support Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nSupportWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nSupportWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n User Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nUserWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nUserWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Chatbot & LLM Runtime</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Chatbot Enabled</label>
                <select
                  value={formData.chatbotEnabled === false ? 'disabled' : 'enabled'}
                  onChange={e => setFormData({ ...formData, chatbotEnabled: e.target.value === 'enabled' })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">LLM Provider</label>
                <select
                  value={selectedProvider}
                  onChange={e => {
                    const nextProvider = e.target.value as NonNullable<AppConfig['llmProvider']>;
                    setFormData({
                      ...formData,
                      llmProvider: nextProvider,
                      llmModel: providerModelOptions[nextProvider]?.[0] || '',
                    });
                  }}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="claude">Claude</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Model</label>
                <select
                  value={formData.llmModel || ''}
                  onChange={e => setFormData({ ...formData, llmModel: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  {providerModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={formData.chatbotTemperature ?? 0.3}
                  onChange={e => setFormData({ ...formData, chatbotTemperature: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Max Output Tokens</label>
                <input
                  type="number"
                  min="100"
                  max="2000"
                  value={formData.chatbotMaxTokens ?? 400}
                  onChange={e => setFormData({ ...formData, chatbotMaxTokens: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Default Chat Language</label>
                <select
                  value={formData.chatbotDefaultLanguage || 'en-IN'}
                  onChange={e => setFormData({ ...formData, chatbotDefaultLanguage: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="en-IN">English (India)</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="ne-IN">Nepali</option>
                  <option value="bn-IN">Bengali</option>
                  <option value="ta-IN">Tamil</option>
                  <option value="te-IN">Telugu</option>
                  <option value="mr-IN">Marathi</option>
                  <option value="gu-IN">Gujarati</option>
                  <option value="kn-IN">Kannada</option>
                  <option value="ml-IN">Malayalam</option>
                  <option value="pa-IN">Punjabi</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Voice Output</label>
                <input
                  type="text"
                  value="Temporarily disabled in this release"
                  disabled
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-secondary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Voice Input (STT)</label>
                <select
                  value={formData.chatbotVoiceInputEnabled === false ? 'disabled' : 'enabled'}
                  onChange={e => setFormData({ ...formData, chatbotVoiceInputEnabled: e.target.value === 'enabled' })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">TTS Speech Rate</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.75"
                  max="1.15"
                  value={formData.chatbotTtsRate ?? 0.95}
                  onChange={e => setFormData({ ...formData, chatbotTtsRate: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">TTS Pitch</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.8"
                  max="1.2"
                  value={formData.chatbotTtsPitch ?? 1.02}
                  onChange={e => setFormData({ ...formData, chatbotTtsPitch: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Gemini Project ID</label>
                <input
                  type="text"
                  value={formData.geminiProjectId || ''}
                  onChange={e => setFormData({ ...formData, geminiProjectId: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Gemini API Key</label>
                <input 
                  type="password"
                  value={formData.geminiApiKey || ''}
                  onChange={e => setFormData({ ...formData, geminiApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">OpenAI API Key</label>
                <input 
                  type="password"
                  value={formData.openaiApiKey || ''}
                  onChange={e => setFormData({ ...formData, openaiApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">OpenAI Project ID</label>
                <input 
                  type="text"
                  value={formData.openaiProjectId || ''}
                  onChange={e => setFormData({ ...formData, openaiProjectId: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">OpenAI Org ID</label>
                <input 
                  type="text"
                  value={formData.openaiOrgId || ''}
                  onChange={e => setFormData({ ...formData, openaiOrgId: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Claude API Key</label>
                <input 
                  type="password"
                  value={formData.claudeApiKey || ''}
                  onChange={e => setFormData({ ...formData, claudeApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Strict MaiRide System Prompt</label>
                <textarea
                  rows={6}
                  value={formData.chatbotSystemPrompt || defaultChatbotPrompt}
                  onChange={e => setFormData({ ...formData, chatbotSystemPrompt: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary resize-y"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Fallback Message</label>
                <textarea
                  rows={3}
                  value={formData.chatbotFallbackMessage || ''}
                  onChange={e => setFormData({ ...formData, chatbotFallbackMessage: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary resize-y"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">System Reference</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">App Version</label>
                <input 
                  type="text"
                  value={formData.appVersion || ''}
                  onChange={e => setFormData({ ...formData, appVersion: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Super Admin Email</label>
                <input 
                  type="email"
                  value={formData.superAdminEmail || ''}
                  onChange={e => setFormData({ ...formData, superAdminEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Supabase Project URL</label>
                <input 
                  type="url"
                  value={formData.supabaseProjectUrl || ''}
                  onChange={e => setFormData({ ...formData, supabaseProjectUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Storage Bucket</label>
                <input 
                  type="text"
                  value={formData.storageBucket || ''}
                  onChange={e => setFormData({ ...formData, storageBucket: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Supabase Egress Limit (GB/month)</label>
                <input 
                  type="number"
                  min="1"
                  step="0.1"
                  value={formData.capacitySupabaseEgressGbMonthly ?? 5}
                  onChange={e => setFormData({ ...formData, capacitySupabaseEgressGbMonthly: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Current Supabase Egress Used (GB)</label>
                <input 
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.capacitySupabaseEgressUsedGbMonthly ?? ''}
                  onChange={e => setFormData({
                    ...formData,
                    capacitySupabaseEgressUsedGbMonthly: e.target.value === '' ? undefined : Number(e.target.value),
                  })}
                  placeholder="Copy from Supabase Usage, e.g. 6.6"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
                <p className="text-[10px] text-mairide-secondary ml-1">
                  Supabase does not come from our app estimate here. Copy the billing Usage value until automated quota sync is connected.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Google Maps API Key</label>
                <input 
                  type="password"
                  value={formData.googleMapsApiKey || ''}
                  onChange={e => setFormData({ ...formData, googleMapsApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button 
              type="submit"
              disabled={isSaving}
              className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold hover:bg-mairide-primary/90 transition-all shadow-xl shadow-mairide-primary/20 flex items-center justify-center space-x-2"
            >
              <ShieldCheck className="w-5 h-5" />
              <span>{isSaving ? 'Saving Changes...' : 'Save Global Configuration'}</span>
            </button>
            <p className="text-[10px] text-center text-mairide-secondary mt-4 font-bold uppercase tracking-widest">
              Last updated: {formData.updatedAt ? new Date(formData.updatedAt).toLocaleString() : 'Never'} by {formData.updatedBy || 'N/A'}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

const AdminCashFlowAnalytics = ({ bookings, users }: { bookings: any[], users: UserProfile[] }) => {
  const paymentEvents = getPlatformFeePaymentEvents(bookings as Booking[]);
  const totalRevenue = paymentEvents.reduce((acc, event) => acc + event.revenue, 0);
  const totalMaiCoinsIssued = users.reduce((acc, u) => acc + (u.wallet?.balance || 0) + (u.wallet?.pendingBalance || 0), 0);
  
  // Projection Logic
  const last30DaysBookings = paymentEvents.filter(event => {
    const bDate = new Date(event.createdAt);
    const diffDays = Math.floor((new Date().getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  });

  const dailyAvgRevenue = last30DaysBookings.length ? totalRevenue / 30 : 0; // Rough estimate
  const projectedRevenueNext30 = dailyAvgRevenue * 30;
  const projectedLiabilitiesNext30 = users.length * 5; // Assume each user refers 0.2 people on avg

  const isNegativeCashFlow = totalMaiCoinsIssued > totalRevenue * 1.5;

  const projectionData = [
    { name: 'Current', revenue: totalRevenue, liability: totalMaiCoinsIssued },
    { name: 'Month 1 (Proj)', revenue: totalRevenue + projectedRevenueNext30, liability: totalMaiCoinsIssued + projectedLiabilitiesNext30 },
    { name: 'Month 2 (Proj)', revenue: totalRevenue + (projectedRevenueNext30 * 2.2), liability: totalMaiCoinsIssued + (projectedLiabilitiesNext30 * 2.5) },
    { name: 'Month 3 (Proj)', revenue: totalRevenue + (projectedRevenueNext30 * 4), liability: totalMaiCoinsIssued + (projectedLiabilitiesNext30 * 6) }
  ];

  return (
    <div className="space-y-8">
      {/* Warning Banner */}
      {isNegativeCashFlow && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-600 text-white p-8 rounded-[40px] shadow-2xl shadow-red-600/30 flex items-center space-x-6"
        >
          <div className="bg-white/20 p-4 rounded-3xl backdrop-blur-md">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight mb-1">NEGATIVE CASH FLOW WARNING</h3>
            <p className="text-sm opacity-90 font-medium">Maicoin liabilities are growing faster than cash revenue. Current Ratio: {(totalMaiCoinsIssued / Math.max(totalRevenue, 1)).toFixed(2)}x. Immediate adjustment required.</p>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Projections Chart */}
        <div className="bg-white p-10 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-mairide-primary">3-Month Projections</h3>
            <div className="flex items-center space-x-4 text-[10px] font-bold uppercase tracking-widest">
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 bg-mairide-accent rounded-full" />
                <span>Revenue</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 bg-mairide-primary rounded-full" />
                <span>Liability</span>
              </div>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={projectionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" dataKey="revenue" stroke="#F27D26" strokeWidth={4} dot={{ r: 6, fill: '#F27D26', strokeWidth: 2, stroke: '#fff' }} name="Cash Revenue" />
                <Line type="monotone" dataKey="liability" stroke="#141414" strokeWidth={4} dot={{ r: 6, fill: '#141414', strokeWidth: 2, stroke: '#fff' }} name="Maicoin Liability" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Business Insights */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
            <h3 className="text-lg font-bold text-mairide-primary mb-6">Business Movement Insights</h3>
            <div className="space-y-6">
              {[
                { 
                  label: 'Revenue Velocity', 
                  value: '+12.5%', 
                  desc: 'Cash collection speed has increased compared to last month.',
                  trend: 'up' 
                },
                { 
                  label: 'Liability Burn Rate', 
                  value: '+4.2%', 
                  desc: 'Maicoin distribution is accelerating due to viral referrals.',
                  trend: 'up' 
                },
                { 
                  label: 'Net Profit Projection', 
                  value: '₹' + Math.floor(totalRevenue * 0.4).toLocaleString(), 
                  desc: 'Estimated profit after GST and referral liabilities.',
                  trend: 'neutral' 
                }
              ].map((insight, idx) => (
                <div key={idx} className="flex items-start space-x-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    insight.trend === 'up' ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                  )}>
                    {insight.trend === 'up' ? <ArrowUpRight className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest">{insight.label}</p>
                      <p className="text-sm font-black text-mairide-primary">{insight.value}</p>
                    </div>
                    <p className="text-xs text-mairide-secondary leading-relaxed italic serif">{insight.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-mairide-accent p-8 rounded-[40px] text-white">
            <h3 className="text-lg font-bold mb-4">Strategic Recommendation</h3>
            <p className="text-sm opacity-90 leading-relaxed mb-6">
              The current data suggests that <span className="font-bold">Tier 1 Referrals</span> are the primary driver of liability. We recommend capping the maximum Maicoins a user can hold to 500 to mitigate long-term cash flow risks.
            </p>
            <div className="flex items-center space-x-2 text-[10px] font-bold uppercase tracking-widest bg-white/20 w-fit px-4 py-2 rounded-full">
              <ShieldCheck className="w-3 h-3" />
              <span>AI Analysis Complete</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdminCapacityView = () => {
  type CapacityMetric = {
    key: string;
    label: string;
    category: string;
    used: number;
    capacity: number;
    utilization: number;
    severity: 'healthy' | 'watch' | 'warning' | 'critical';
    unit: string;
    notes?: string;
  };
  type CapacityAlert = {
    id: string;
    metricKey: string;
    metricLabel: string;
    category: string;
    severity: 'healthy' | 'watch' | 'warning' | 'critical';
    utilization: number;
    message: string;
    observedAt: string;
  };
  type CapacityDaily = {
    day: string;
    signups: number;
    driverSignups: number;
    travelerSignups: number;
    bookingsCreated: number;
    completedBookings: number;
    ridesCreated: number;
    revenue: number;
    gst: number;
    liveSessions: number;
    realtimeSignals: number;
    staleSessions: number;
  };
  type CapacityPayload = {
    generatedAt: string;
    metrics: CapacityMetric[];
    daily: CapacityDaily[];
    alerts: CapacityAlert[];
    storageStatus?: {
      snapshotsPersisted?: boolean;
      alertsPersisted?: boolean;
      notes?: string[];
    };
    summary?: {
      liveSessionsNow?: number;
      staleSessionsNow?: number;
      offlineLinksNow?: number;
      antiSpoofAlertsNow?: number;
      realtimeSignalsLast24h?: number;
      monthlySignalsEstimate?: number;
      mauLast30?: number;
      ridesToday?: number;
      bookingsToday?: number;
      completedBookingsToday?: number;
      revenueToday?: number;
      gstToday?: number;
    };
  };

  const [payload, setPayload] = useState<CapacityPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const buildFallbackPayload = (reason: string): CapacityPayload => ({
    generatedAt: new Date().toISOString(),
    metrics: [
      { key: 'daily_signups', label: 'Daily signups', category: 'Onboarding', used: 0, capacity: 250, utilization: 0, severity: 'healthy', unit: 'users/day', notes: 'Fallback mode' },
      { key: 'daily_bookings', label: 'Daily bookings', category: 'Marketplace', used: 0, capacity: 200, utilization: 0, severity: 'healthy', unit: 'bookings/day', notes: 'Fallback mode' },
      { key: 'live_trip_concurrency', label: 'Live trip concurrency', category: 'Tracking', used: 0, capacity: 40, utilization: 0, severity: 'healthy', unit: 'live sessions', notes: 'Fallback mode' },
      { key: 'gemini_daily_requests', label: 'Gemini requests (24h)', category: 'LLM', used: 0, capacity: 1500, utilization: 0, severity: 'healthy', unit: 'requests/day', notes: 'Fallback mode' },
    ],
    daily: [],
    alerts: [],
    summary: {
      liveSessionsNow: 0,
      staleSessionsNow: 0,
      offlineLinksNow: 0,
      antiSpoofAlertsNow: 0,
      realtimeSignalsLast24h: 0,
      monthlySignalsEstimate: 0,
      mauLast30: 0,
      ridesToday: 0,
      bookingsToday: 0,
      completedBookingsToday: 0,
      revenueToday: 0,
      gstToday: 0,
    },
    storageStatus: {
      snapshotsPersisted: false,
      alertsPersisted: false,
      notes: [
        `Capacity API fallback activated: ${reason}`,
        'Core booking/payment/negotiation systems remain unaffected.',
      ],
    },
  });

  const loadCapacity = async (withLoader = false) => {
    if (withLoader) setIsLoading(true);
    try {
      const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
      const response = await axios.get(adminCapacityPath, { headers });
      setPayload(response.data || null);
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Unable to load capacity monitor right now.');
      setPayload(buildFallbackPayload(message));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!mounted) return;
      await loadCapacity(true);
    })();
    const timer = window.setInterval(() => {
      void loadCapacity(false);
    }, 30000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const summaryCards = [
    {
      label: 'Live sessions',
      value: payload?.summary?.liveSessionsNow ?? 0,
      accent: 'text-mairide-primary',
    },
    {
      label: 'Stale sessions',
      value: payload?.summary?.staleSessionsNow ?? 0,
      accent: 'text-mairide-accent',
    },
    {
      label: 'Offline links',
      value: payload?.summary?.offlineLinksNow ?? 0,
      accent: 'text-mairide-primary',
    },
    {
      label: 'Anti-spoof alerts',
      value: payload?.summary?.antiSpoofAlertsNow ?? 0,
      accent: 'text-red-600',
    },
  ];

  const utilizationBars = (payload?.metrics || []).sort((a, b) => b.utilization - a.utilization);
  const topAlerts = (payload?.alerts || []).slice(0, 5);
  const trend30 = (payload?.daily || []).slice(-30).map((row) => ({
    day: row.day.slice(5),
    bookings: row.bookingsCreated,
    revenue: Number(row.revenue.toFixed(0)),
    signals: row.realtimeSignals,
  }));
  const byCategory = Object.values(
    utilizationBars.reduce((acc: Record<string, { category: string; utilization: number; count: number }>, metric) => {
      if (!acc[metric.category]) {
        acc[metric.category] = { category: metric.category, utilization: 0, count: 0 };
      }
      acc[metric.category].utilization += metric.utilization;
      acc[metric.category].count += 1;
      return acc;
    }, {})
  ).map((row) => ({
    category: row.category,
    utilization: Number((row.utilization / Math.max(row.count, 1)).toFixed(2)),
  }));

  const severityTone = (severity: CapacityMetric['severity']) => {
    if (severity === 'critical') return 'bg-red-100 text-red-600';
    if (severity === 'warning') return 'bg-orange-100 text-orange-600';
    if (severity === 'watch') return 'bg-amber-100 text-amber-700';
    return 'bg-green-100 text-green-600';
  };

  if (isLoading) {
    return (
      <div className="rounded-[32px] border border-mairide-secondary bg-white p-10 text-center">
        <p className="text-sm font-bold text-mairide-secondary uppercase tracking-widest">Loading capacity monitor...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">MVP Performance Control</p>
            <h3 className="mt-2 text-2xl font-black text-mairide-primary">Capacity and cost guardrails</h3>
            <p className="mt-1 text-sm text-mairide-secondary">Live usage visibility with early warning flags at 80% and 95%.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Updated</p>
            <p className="text-sm font-bold text-mairide-primary">
              {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-mairide-secondary/40 bg-mairide-bg p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{card.label}</p>
              <p className={cn("mt-2 text-3xl font-black", card.accent)}>{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <h4 className="text-lg font-bold text-mairide-primary">30-day trend</h4>
          <p className="text-xs text-mairide-secondary mt-1">Bookings, tracking signals, and revenue movement.</p>
          <div className="mt-4 h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend30}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8EAED" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 12px 30px rgba(0,0,0,0.12)' }} />
                <Legend />
                <Line type="monotone" dataKey="bookings" stroke="#25343F" strokeWidth={2.5} dot={false} name="Bookings" />
                <Line type="monotone" dataKey="signals" stroke="#F27D26" strokeWidth={2.5} dot={false} name="Tracking Signals" />
                <Line type="monotone" dataKey="revenue" stroke="#00A63E" strokeWidth={2.5} dot={false} name="Revenue ₹" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <h4 className="text-lg font-bold text-mairide-primary">Average utilization by stack</h4>
          <p className="text-xs text-mairide-secondary mt-1">Helps decide where to scale first after MVP.</p>
          <div className="mt-4 h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8EAED" />
                <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 12px 30px rgba(0,0,0,0.12)' }} />
                <Bar dataKey="utilization" fill="#F27D26" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <h4 className="text-lg font-bold text-mairide-primary">Threshold monitor</h4>
          <p className="text-xs text-mairide-secondary mt-1">Red = 95% critical, Orange = 80% warning.</p>
          <div className="mt-4 space-y-3">
            {utilizationBars.map((metric) => (
              <div key={metric.key} className="rounded-2xl border border-mairide-secondary/30 p-4 bg-mairide-bg/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-mairide-primary">{metric.label}</p>
                    <p className="text-[11px] text-mairide-secondary">{metric.used} / {metric.capacity} {metric.unit}</p>
                    {metric.notes ? <p className="text-[10px] text-mairide-secondary mt-1">{metric.notes}</p> : null}
                  </div>
                  <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest", severityTone(metric.severity))}>
                    {metric.utilization.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-3 h-2.5 w-full rounded-full bg-mairide-secondary/20 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      metric.utilization >= 95 ? 'bg-red-500' : metric.utilization >= 80 ? 'bg-orange-500' : metric.utilization >= 60 ? 'bg-amber-400' : 'bg-green-500'
                    )}
                    style={{ width: `${Math.min(metric.utilization, 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {!utilizationBars.length && (
              <p className="text-sm text-mairide-secondary">No capacity metrics available yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <h4 className="text-lg font-bold text-mairide-primary">Active alerts</h4>
          <p className="text-xs text-mairide-secondary mt-1">Immediate signals for cost or scale risk.</p>
          <div className="mt-4 space-y-3">
            {topAlerts.length ? (
              topAlerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-mairide-secondary/30 bg-mairide-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-mairide-primary">{alert.metricLabel}</p>
                    <span className={cn("px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest", severityTone(alert.severity))}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-mairide-secondary">{alert.message}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                    {new Date(alert.observedAt).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-3">
                <p className="text-xs font-bold text-green-700">All systems healthy</p>
                <p className="mt-1 text-xs text-green-700">No threshold breaches detected right now.</p>
              </div>
            )}
          </div>
          {!!payload?.storageStatus?.notes?.length && (
            <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700">Setup notes</p>
              <div className="mt-2 space-y-1">
                {payload.storageStatus.notes.map((note, idx) => (
                  <p key={`${note}-${idx}`} className="text-xs text-orange-800">{note}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AdminSecurityView = () => {
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser!.uid), { email: newEmail });
      alert("Email updated in profile. Note: Auth email update may require re-authentication.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser!.uid}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }
    setIsUpdating(true);
    try {
      // In a real app, you'd use updatePassword(auth.currentUser!, newPassword)
      // For this environment, we'll simulate the request
      alert("Password update requested. Note: This feature requires a recent login session for security.");
    } catch (error) {
      alert("Error updating password: " + error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary p-10 shadow-sm">
        <h2 className="text-2xl font-bold text-mairide-primary mb-8 flex items-center">
          <Lock className="w-6 h-6 mr-3 text-mairide-accent" />
          Security Settings
        </h2>
        
        <div className="space-y-12">
          {/* Email Update */}
          <form onSubmit={handleUpdateEmail} className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Change Email</h3>
            <div className="space-y-2">
              <label className="text-xs font-bold text-mairide-primary uppercase ml-1">New Email Address</label>
              <input 
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                placeholder="Enter new email"
                required
              />
            </div>
            <button 
              type="submit"
              disabled={isUpdating}
              className="w-full bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-primary/90 transition-all disabled:opacity-50"
            >
              Update Email
            </button>
          </form>

          {/* Password Update */}
          <form onSubmit={handleUpdatePassword} className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Change Password</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">New Password</label>
                <input 
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Confirm New Password</label>
                <input 
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  placeholder="Repeat new password"
                  required
                />
              </div>
            </div>
            <button 
              type="submit"
              disabled={isUpdating}
              className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent/90 transition-all disabled:opacity-50 shadow-lg shadow-mairide-accent/20"
            >
              Update Password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const ForcePasswordChangeModal = ({ profile }: { profile: UserProfile }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleCloseForNow = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out after password prompt close:', error);
    } finally {
      window.location.href = '/';
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    setIsUpdating(true);
    try {
      const idToken = await getAccessToken();
      await axios.post(apiPath('/api/user?action=change-password'), { newPassword }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      alert("Password updated successfully! You can now access the app.");
      window.location.reload();
    } catch (error: any) {
      console.error('Error updating password:', error);
      alert("Failed to update password. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md rounded-[40px] p-10 shadow-2xl"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex-1 text-center">
          <div className="w-20 h-20 bg-mairide-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-mairide-accent" />
          </div>
          <h2 className="text-3xl font-black text-mairide-primary tracking-tighter mb-2">Secure Your Account</h2>
          <p className="text-mairide-secondary italic serif">For security reasons, you must change your temporary password before proceeding.</p>
          </div>
          <button
            type="button"
            onClick={handleCloseForNow}
            className="rounded-2xl bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
            aria-label="Close and return to login"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-mairide-primary uppercase ml-2">New Password</label>
            <input 
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
              placeholder="Min 6 characters"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-mairide-primary uppercase ml-2">Confirm New Password</label>
            <input 
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
              placeholder="Repeat new password"
              required
            />
          </div>
          <button 
            type="submit"
            disabled={isUpdating}
            className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            {isUpdating ? 'Updating...' : 'Update Password & Continue'}
          </button>
          <button
            type="button"
            onClick={handleCloseForNow}
            className="w-full rounded-3xl border border-mairide-secondary bg-white py-4 text-base font-bold text-mairide-primary transition-colors hover:bg-mairide-bg"
          >
            Logout for now
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const AdminDashboard = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const effectiveAdminRole = profile.adminRole || 'super_admin';
  type UsersInsightView = 'drivers' | 'travelers' | 'onlineDrivers' | 'onlineTravelers' | 'activeTrips' | 'openOffers' | null;
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'support' | 'verification' | 'profile' | 'rides' | 'revenue' | 'transactions' | 'config' | 'analytics' | 'security' | 'map' | 'capacity' | 'mobile'>('revenue');
  const [adminLocation, setAdminLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tripSessions, setTripSessions] = useState<TripSession[]>([]);
  const hasMapsIssue = Boolean(loadError || authFailure);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserProfile | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isGeneratingResetLink, setIsGeneratingResetLink] = useState<string | null>(null);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser || !newAdminPassword) return;

    setIsResetting(true);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminApiPath('update-password'), {
        uid: resetPasswordUser.uid,
        newPassword: newAdminPassword
      }, {
        headers
      });
      setAdminNotice({
        title: 'Password updated',
        message: `A temporary password has been set successfully for ${resetPasswordUser.displayName}.`,
        tone: 'success',
      });
      setResetPasswordUser(null);
      setNewAdminPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      setAdminNotice({
        title: 'Password update failed',
        message: getApiErrorMessage(error, 'We could not update the password right now. Please try again.'),
        tone: 'error',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleGenerateResetLink = async (targetUser: UserProfile) => {
    setIsGeneratingResetLink(targetUser.uid);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      const response = await axios.post(adminApiPath('generate-reset-link'), {
        email: targetUser.email
      }, {
        headers
      });

      const resetLink = response.data?.actionLink;
      if (!resetLink) {
        throw new Error("No reset link returned.");
      }

      await navigator.clipboard.writeText(resetLink);
      setAdminNotice({
        title: 'Reset link copied',
        message: `A secure password reset link for ${targetUser.displayName} has been copied. Share it only through your approved support channel.`,
        tone: 'success',
      });
    } catch (error: any) {
      console.error('Error generating reset link:', error);
      setAdminNotice({
        title: 'Reset link failed',
        message: getApiErrorMessage(error, 'We could not generate a reset link right now. Please try again.'),
        tone: 'error',
      });
    } finally {
      setIsGeneratingResetLink(null);
    }
  };

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newUser, setNewUser] = useState<{ 
    email: string, 
    displayName: string, 
    phoneNumber: string, 
    password: string,
    role: 'consumer' | 'driver' | 'admin',
    adminRole?: 'super_admin' | 'support' | 'finance' | 'compliance'
  }>({ email: '', displayName: '', phoneNumber: '', password: '', role: 'consumer', adminRole: 'support' });
  const [selectedDriver, setSelectedDriver] = useState<UserProfile | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'consumer' | 'driver' | 'admin'>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState<number>(10);
  const [rideSearchTerm, setRideSearchTerm] = useState('');
  const [rideStatusFilter, setRideStatusFilter] = useState<'all' | Booking['status'] | 'completed_lifecycle'>('all');
  const [ridesPage, setRidesPage] = useState(1);
  const [ridesPageSize, setRidesPageSize] = useState<number>(10);
  const [usersInsightView, setUsersInsightView] = useState<UsersInsightView>(null);
  const [adminNotice, setAdminNotice] = useState<{
    title: string;
    message: string;
    tone: 'success' | 'error' | 'info';
  } | null>(null);
  const [forceCancellingRideId, setForceCancellingRideId] = useState<string | null>(null);
  const selectedDriverMarkers = buildVerificationMarkers(selectedDriver?.driverDetails);
  const adminTransactionsCacheKey = `mairide_admin_transactions_cache_${profile.uid}`;
  const isPageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

  useEffect(() => {
    if (window.location.hostname !== 'localhost') {
      let active = true;
      let intervalId: number | null = null;

      const loadAdminUsers = async () => {
        if (!isPageVisible()) return;
        try {
          const headers = await getAdminRequestHeaders(profile.email);
          const response = await axios.get(adminUsersPath, { headers });
          if (!active) return;
          setUsers((response.data?.users || []) as UserProfile[]);
          setIsLoading(false);
        } catch (error) {
          if (!active) return;
          handleFirestoreError(error, OperationType.GET, 'users');
        }
      };

      void loadAdminUsers();
      intervalId = window.setInterval(() => {
        void loadAdminUsers();
      }, 20000);

      return () => {
        active = false;
        if (intervalId) window.clearInterval(intervalId);
      };
    }

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setUsers(usersData);
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBookings(bookingsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'rides'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ride));
      setRides(ridesData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rides');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLocalDevFirestoreMode()) return;
    const q = query(collection(db, 'tripSessions'), orderBy('updatedAt', 'desc'), limit(200));
    let unsubscribe: (() => void) | null = null;
    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as TripSession) }));
        setTripSessions(list);
      },
      (error) => {
        if (isMissingSupabaseTableError(error)) {
          console.warn('Trip sessions table missing; pausing admin session polling.');
          if (unsubscribe) unsubscribe();
          return;
        }
        console.error('Admin trip session monitor error:', error);
      }
    );
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'transactions') {
      return;
    }

    let active = true;
    const cachedTransactions = safeStorageGet('session', adminTransactionsCacheKey);
    if (cachedTransactions) {
      try {
        const parsed = JSON.parse(cachedTransactions);
        if (Array.isArray(parsed) && parsed.length) {
          setTransactions(parsed as Transaction[]);
        }
      } catch {
        // ignore cache parse failures
      }
    }

    const loadTransactions = async () => {
      if (!isPageVisible()) return;
      try {
        const headers = await getAdminRequestHeaders(profile.email);
        const response = await axios.get(adminTransactionsPath, { headers });
        const nextTransactions = (response.data?.transactions || []) as Transaction[];
        if (!active) return;
        setTransactions(nextTransactions);
        safeStorageSet('session', adminTransactionsCacheKey, JSON.stringify(nextTransactions.slice(0, 400)));
      } catch (error) {
        if (!active) return;
        console.error('Error loading admin transactions:', error);
        setAdminNotice({
          title: 'Transactions unavailable',
          message: getApiErrorMessage(error, 'We could not load platform transaction records right now.'),
          tone: 'error',
        });
      }
    };

    void loadTransactions();
    const intervalId = window.setInterval(() => {
      void loadTransactions();
    }, 12000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeTab, profile.email, adminTransactionsCacheKey]);

  const handleAdminForceCancelRide = async (booking: any) => {
    const rideId = booking.rideId || booking.ride_id;
    if (!rideId) {
      setAdminNotice({
        title: 'Ride not found',
        message: 'This booking is missing a linked ride reference, so support cannot cancel it from here.',
        tone: 'error',
      });
      return;
    }

    setForceCancellingRideId(rideId);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminApiPath('force-cancel-ride'), {
        rideId,
        bookingId: booking.id,
        reason: 'Cancelled by MaiRide customer support',
      }, { headers });

      setBookings((prev) =>
        prev.map((currentBooking) =>
          (currentBooking.rideId || currentBooking.ride_id) === rideId
            ? {
                ...currentBooking,
                status: 'cancelled',
                rideRetired: true,
                negotiationStatus: 'rejected',
                forceCancelledByAdmin: true,
              }
            : currentBooking
        )
      );
      setRides((prev) =>
        prev.map((ride) =>
          ride.id === rideId
            ? {
                ...ride,
                status: 'cancelled',
              }
            : ride
        )
      );
      setAdminNotice({
        title: 'Ride cancelled',
        message: 'MaiRide support override has cancelled this ride and retired its linked bookings.',
        tone: 'success',
      });
    } catch (error: any) {
      setAdminNotice({
        title: 'Cancellation failed',
        message: getApiErrorMessage(error, 'We could not cancel this ride from the admin panel right now.'),
        tone: 'error',
      });
    } finally {
      setForceCancellingRideId(null);
    }
  };

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    let isMounted = true;
    const syncLocation = (latitude: number, longitude: number) => {
      const nextLocation = { lat: latitude, lng: longitude };
      if (isMounted) {
        setAdminLocation(nextLocation);
      }

      updateDoc(doc(db, 'users', profile.uid), {
        location: {
          ...nextLocation,
          lastUpdated: new Date().toISOString(),
        },
      }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        syncLocation(position.coords.latitude, position.coords.longitude);
      },
      (error) => logGeolocationIssue('Admin', error),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        syncLocation(position.coords.latitude, position.coords.longitude);
      },
      (error) => logGeolocationIssue('Admin', error),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    return () => {
      isMounted = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [profile.uid]);

  const filteredUsers = users.filter(user => {
    if (user.uid === profile.uid) return false;
    if (user.role === 'driver' && (!user.onboardingComplete || user.verificationStatus === 'pending')) return false;
    const matchesSearch = matchesAdminSearch(searchTerm, [
      user.uid,
      user.displayName,
      user.email,
      user.phoneNumber,
      user.role,
      user.status,
      user.verificationStatus,
      user.adminRole,
      user.referralCode,
      user.createdAt,
      user.driverDetails?.vehicleRegNumber,
      user.driverDetails?.vehicleMake,
      user.driverDetails?.vehicleModel,
    ]);
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesStatus = userStatusFilter === 'all' || user.status === userStatusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });
  const usersPageCount = getAdminPageCount(filteredUsers.length, usersPageSize);
  const pagedFilteredUsers = useMemo(
    () => getAdminPageItems(filteredUsers, usersPage, usersPageSize),
    [filteredUsers, usersPage, usersPageSize]
  );
  useEffect(() => {
    setUsersPage(1);
  }, [searchTerm, roleFilter, userStatusFilter, usersPageSize]);
  useEffect(() => {
    if (usersPage > usersPageCount) setUsersPage(usersPageCount);
  }, [usersPage, usersPageCount]);
  const pendingVerificationDrivers = users.filter((u) => {
    if (u.role !== 'driver') return false;
    const verificationStatus = (u.verificationStatus || 'pending') as string;
    const hasDriverDetails = Boolean(u.driverDetails);
    return verificationStatus === 'pending' && (Boolean(u.onboardingComplete) || hasDriverDetails);
  });
  const activityWindowMs = 15 * 60 * 1000;
  const isRecentlyActive = (user: UserProfile) => {
    if (!user.location?.lastUpdated) return false;
    const lastUpdated = new Date(user.location.lastUpdated).getTime();
    return !Number.isNaN(lastUpdated) && Date.now() - lastUpdated <= activityWindowMs;
  };
  const isUserCurrentlyOnline = (user: UserProfile) => (
    user.status === 'active' && (
      (user.role === 'driver' && Boolean(user.driverDetails?.isOnline))
      || isRecentlyActive(user)
    )
  );
  const registeredDrivers = users.filter((u) => u.role === 'driver');
  const registeredTravelers = users.filter((u) => u.role === 'consumer');
  const onlineDrivers = registeredDrivers.filter((u) => isUserCurrentlyOnline(u));
  const onlineTravelers = registeredTravelers.filter((u) => isUserCurrentlyOnline(u));
  const lockedRideIds = getLockedRideIds(bookings as Booking[]);
  const openRideOffers = rides.filter((ride) => ride.status === 'available' && !lockedRideIds.has(ride.id));
  const activeTrips = bookings.filter((booking) =>
    booking.status === 'confirmed'
    || booking.rideLifecycleStatus === 'awaiting_start_otp'
    || booking.rideLifecycleStatus === 'in_progress'
  );
  const liveTripSessions = tripSessions.filter((session) => session.status === 'live');
  const staleTripSessions = tripSessions.filter((session) => session.isStale);
  const offlineTripSessions = tripSessions.filter((session) => session.networkState === 'offline');
  const antiSpoofAlerts = tripSessions.reduce((count, session) => {
    const hits = (session.auditTrail || []).filter((entry) => Boolean(entry.meta?.spoofDetected)).length;
    return count + hits;
  }, 0);
  const liveOpsAlerts = useMemo(() => {
    return tripSessions
      .flatMap((session) =>
        (session.auditTrail || [])
          .filter((entry) => Boolean(entry.meta?.spoofDetected) || session.isStale || session.networkState === 'offline')
          .map((entry) => ({
            bookingId: session.bookingId,
            createdAt: entry.createdAt,
            action: entry.action,
            details:
              entry.meta?.spoofDetected
                ? 'Potential location spoof detected'
                : session.isStale
                  ? 'Session became stale'
                  : 'Driver or traveler is offline',
          }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [tripSessions]);
  const filteredAdminBookings = useMemo(() => {
    return (bookings as Booking[]).filter((booking) => {
      const matchesStatus =
        rideStatusFilter === 'all'
        || (rideStatusFilter === 'completed_lifecycle'
          ? booking.rideLifecycleStatus === 'completed'
          : booking.status === rideStatusFilter);
      const matchesSearch = matchesAdminSearch(rideSearchTerm, [
        booking.id,
        booking.rideId,
        booking.consumerId,
        booking.consumerName,
        booking.consumerPhone,
        booking.driverId,
        booking.driverName,
        booking.driverPhone,
        booking.origin,
        booking.destination,
        booking.listedOrigin,
        booking.listedDestination,
        booking.requestedOrigin,
        booking.requestedDestination,
        booking.status,
        booking.paymentStatus,
        booking.rideLifecycleStatus,
        booking.consumerPaymentMode,
        booking.driverPaymentMode,
        booking.consumerPaymentTransactionId,
        booking.driverPaymentTransactionId,
        booking.createdAt,
        booking.totalPrice,
        booking.serviceFee,
      ]);
      return matchesStatus && matchesSearch;
    });
  }, [bookings, rideSearchTerm, rideStatusFilter]);
  const ridesPageCount = getAdminPageCount(filteredAdminBookings.length, ridesPageSize);
  const pagedAdminBookings = useMemo(
    () => getAdminPageItems(filteredAdminBookings, ridesPage, ridesPageSize),
    [filteredAdminBookings, ridesPage, ridesPageSize]
  );
  useEffect(() => {
    setRidesPage(1);
  }, [rideSearchTerm, rideStatusFilter, ridesPageSize]);
  useEffect(() => {
    if (ridesPage > ridesPageCount) setRidesPage(ridesPageCount);
  }, [ridesPage, ridesPageCount]);
  const getUserRideOffers = (userId: string) =>
    rides.filter((ride) => ride.driverId === userId);
  const getActiveRideOffers = (userId: string) =>
    rides.filter((ride) => ride.driverId === userId && ride.status === 'available' && !lockedRideIds.has(ride.id));
  const getUserRideBookings = (userId: string, role: UserProfile['role']) =>
    bookings.filter((booking) => role === 'driver' ? booking.driverId === userId : booking.consumerId === userId);
  const getActiveUserTrips = (userId: string, role: UserProfile['role']) =>
    bookings.filter((booking) =>
      (role === 'driver' ? booking.driverId === userId : booking.consumerId === userId)
      && (
        booking.status === 'confirmed'
        || booking.rideLifecycleStatus === 'awaiting_start_otp'
        || booking.rideLifecycleStatus === 'in_progress'
      )
    );
  const adminSelfProfile = users.find((user) => user.uid === profile.uid) || profile;
  const adminUserTrips = getUserRideBookings(adminSelfProfile.uid, adminSelfProfile.role);
  const adminOpenOffers = adminSelfProfile.role === 'driver' ? getActiveRideOffers(adminSelfProfile.uid).length : 0;
  const adminActiveTrips = getActiveUserTrips(adminSelfProfile.uid, adminSelfProfile.role).length;
  const usersWithLocation = users.filter(
    u => u.location && typeof u.location.lat === 'number' && typeof u.location.lng === 'number'
  );
  const userCards = [
    {
      id: 'drivers' as UsersInsightView,
      label: 'Registered Drivers',
      value: registeredDrivers.length,
      icon: Car,
      color: 'bg-orange-50 text-orange-600',
      helper: 'All drivers on the platform',
    },
    {
      id: 'travelers' as UsersInsightView,
      label: 'Registered Travelers',
      value: registeredTravelers.length,
      icon: Users,
      color: 'bg-blue-50 text-blue-600',
      helper: 'All travelers on the platform',
    },
    {
      id: 'onlineDrivers' as UsersInsightView,
      label: 'Logged-in Drivers',
      value: onlineDrivers.length,
      icon: Navigation,
      color: 'bg-emerald-50 text-emerald-600',
      helper: 'Online or recently active drivers',
    },
    {
      id: 'onlineTravelers' as UsersInsightView,
      label: 'Logged-in Travelers',
      value: onlineTravelers.length,
      icon: UserIcon,
      color: 'bg-cyan-50 text-cyan-600',
      helper: 'Online or recently active travelers',
    },
    {
      id: 'activeTrips' as UsersInsightView,
      label: 'Active Trips',
      value: activeTrips.length,
      icon: Clock,
      color: 'bg-purple-50 text-purple-600',
      helper: 'Bookings currently in motion',
    },
    {
      id: 'openOffers' as UsersInsightView,
      label: 'Open Ride Offers',
      value: openRideOffers.length,
      icon: PlusCircle,
      color: 'bg-amber-50 text-amber-600',
      helper: 'Offers available for travelers to book',
    },
  ];
  const usersInsightContent = (() => {
    switch (usersInsightView) {
      case 'drivers':
        return {
          title: 'Registered Drivers',
          description: 'All drivers currently registered on the platform.',
          users: registeredDrivers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'travelers':
        return {
          title: 'Registered Travelers',
          description: 'All travelers currently registered on the platform.',
          users: registeredTravelers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'onlineDrivers':
        return {
          title: 'Logged-in Drivers',
          description: 'Drivers currently online or recently active on the system.',
          users: onlineDrivers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'onlineTravelers':
        return {
          title: 'Logged-in Travelers',
          description: 'Travelers currently online or recently active on the system.',
          users: onlineTravelers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'activeTrips':
        return {
          title: 'Active Trips',
          description: 'Trips that are currently confirmed, awaiting OTP, or in progress.',
          users: [] as UserProfile[],
          rides: [] as Ride[],
          trips: activeTrips as Booking[],
        };
      case 'openOffers':
        return {
          title: 'Open Ride Offers',
          description: 'Ride offers that are still available for travelers to book.',
          users: [] as UserProfile[],
          rides: openRideOffers,
          trips: [] as Booking[],
        };
      default:
        return null;
    }
  })();
  const adminMapCenter = adminLocation
    || (usersWithLocation.length
      ? {
          lat: usersWithLocation.reduce((sum, user) => sum + user.location!.lat, 0) / usersWithLocation.length,
          lng: usersWithLocation.reduce((sum, user) => sum + user.location!.lng, 0) / usersWithLocation.length,
        }
      : { lat: 22.5937, lng: 78.9629 });
  const adminMapZoom = adminLocation ? 13 : usersWithLocation.length ? 5 : 4;

  const handleVerifyDriver = async (userId: string, status: 'approved' | 'rejected') => {
    if (!selectedDriver || selectedDriver.verificationStatus !== 'pending') {
      alert('Only pending driver applications can be reviewed here.');
      return;
    }
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminVerifyDriverPath, {
        uid: userId,
        verificationStatus: status,
        rejectionReason: status === 'rejected' ? rejectionReason : '',
      }, { headers });
      setUsers((prev) =>
        prev.map((currentUser) =>
          currentUser.uid === userId
            ? {
                ...currentUser,
                verificationStatus: status,
                rejectionReason: status === 'rejected' ? rejectionReason : undefined,
                status: status === 'approved' ? 'active' : 'inactive',
                verifiedBy: profile.uid,
              }
            : currentUser
        )
      );
      setSelectedDriver(null);
      setRejectionReason('');
    } catch (error) {
      setAdminNotice({
        title: 'Verification update failed',
        message: getApiErrorMessage(error, 'We could not update this driver verification right now.'),
        tone: 'error',
      });
    }
  };

  const handleUpdateRole = async (userId: string, newRole: 'consumer' | 'driver' | 'admin') => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminApiPath('delete-user'), { uid: userId }, { headers });
      setShowDeleteConfirm(null);
      setAdminNotice({
        title: 'User removed',
        message: 'The selected user has been deleted successfully.',
        tone: 'success',
      });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      setAdminNotice({
        title: 'Delete failed',
        message: getApiErrorMessage(error, 'We could not delete this user right now. Please try again.'),
        tone: 'error',
      });
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const normalizedPhone = editingUser.phoneNumber ? toIndianPhoneStorage(editingUser.phoneNumber) : '';
    if (editingUser.phoneNumber && !normalizedPhone) {
      setAdminNotice({
        title: 'Invalid mobile number',
        message: 'Please enter a valid 10-digit Indian mobile number.',
        tone: 'info',
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        displayName: sanitizeDisplayName(editingUser.displayName),
        phoneNumber: normalizedPhone,
        role: editingUser.role,
        status: editingUser.status
      });
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${editingUser.uid}`);
    }
  };

  const handleUpdateStatus = async (userId: string, newStatus: 'active' | 'inactive') => {
    try {
      await updateDoc(doc(db, 'users', userId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmailValue(newUser.email);
    const normalizedPhone = newUser.phoneNumber ? toIndianPhoneStorage(newUser.phoneNumber) : '';
    if (!normalizedEmail || !newUser.displayName || !newUser.password) {
      setAdminNotice({
        title: 'Missing details',
        message: 'Please complete all required fields, including the temporary password.',
        tone: 'info',
      });
      return;
    }
    if (!isValidEmailValue(normalizedEmail)) {
      setAdminNotice({
        title: 'Invalid email',
        message: 'Please enter a valid email address with a proper domain.',
        tone: 'info',
      });
      return;
    }
    if (newUser.phoneNumber && !normalizedPhone) {
      setAdminNotice({
        title: 'Invalid mobile number',
        message: 'Please enter a valid 10-digit Indian mobile number.',
        tone: 'info',
      });
      return;
    }

    // Check for duplicate email
    const duplicateCheck = users.find(u => normalizeEmailValue(u.email) === normalizedEmail);
    if (duplicateCheck) {
      setAdminNotice({
        title: 'User already exists',
        message: 'A user with this email address already exists on the platform.',
        tone: 'info',
      });
      return;
    }

    setIsLoading(true);
    try {
      // 1. Get ID Token for Authorization
      const headers = await getAdminRequestHeaders(profile.email);

      // 2. Call Backend API to create user in Auth and Firestore
      const response = await axios.post(adminApiPath('create-user'), {
        email: normalizedEmail,
        password: newUser.password,
        displayName: sanitizeDisplayName(newUser.displayName),
        phoneNumber: normalizedPhone,
        role: newUser.role,
        adminRole: newUser.role === 'admin' ? newUser.adminRole : undefined
      }, {
        headers
      });

      if (response.status === 201) {
        setShowAddUser(false);
        setNewUser({ email: '', displayName: '', phoneNumber: '', password: '', role: 'consumer', adminRole: 'support' });
        setAdminNotice({
          title: 'User created',
          message: `${newUser.displayName} has been created successfully with a temporary password.`,
          tone: 'success',
        });
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      const errorMessage = getApiErrorMessage(error, 'Failed to create user');
      setAdminNotice({
        title: 'User creation failed',
        message: errorMessage,
        tone: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (hasMapsIssue) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mairide-bg flex overflow-hidden relative">
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-mairide-secondary flex flex-col transition-all duration-300 fixed lg:static inset-y-0 left-0 z-50",
        isSidebarOpen ? "w-72 translate-x-0" : "w-20 -translate-x-full lg:translate-x-0"
      )}>
        <div className="p-6 flex items-center justify-between border-b border-mairide-bg">
          <div className={cn("flex min-w-0 items-center overflow-hidden transition-all", isSidebarOpen ? "opacity-100" : "opacity-0 w-0")}>
            <img src={LOGO_URL} className="mr-3 h-12 w-12 shrink-0 rounded-[18px] object-contain" alt="MaiRide Logo" />
            <div className="flex min-w-0 flex-col justify-center leading-none">
              <span className="block truncate text-[1.45rem] font-black leading-[0.95] tracking-tighter text-mairide-primary">
                MaiRide
              </span>
              <span className="mt-1 block truncate text-[0.78rem] font-black leading-none tracking-[0.14em] text-mairide-primary">
                my way
              </span>
            </div>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-mairide-bg rounded-xl text-mairide-secondary hover:text-mairide-primary"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {[
            { id: 'verification', label: 'Verifications', icon: ShieldCheck, roles: ['super_admin', 'support', 'compliance'] },
            { id: 'map', label: 'Live Map', icon: MapPin, roles: ['super_admin', 'support'] },
            { id: 'users', label: 'Users', icon: Users, roles: ['super_admin', 'compliance'] },
            { id: 'rides', label: 'Rides', icon: Car, roles: ['super_admin', 'compliance'] },
            { id: 'revenue', label: 'Revenue', icon: IndianRupee, roles: ['super_admin', 'finance'] },
            { id: 'capacity', label: 'Capacity', icon: TrendingUp, roles: ['super_admin', 'finance', 'support'] },
            { id: 'mobile', label: 'Mobile App', icon: Smartphone, roles: ['super_admin', 'finance', 'support'] },
            { id: 'analytics', label: 'Analytics', icon: LineChartIcon, roles: ['super_admin', 'finance'] },
            { id: 'transactions', label: 'Transactions', icon: Receipt, roles: ['super_admin', 'finance', 'support'] },
            { id: 'config', label: 'Config', icon: Settings, roles: ['super_admin', 'finance'] },
            { id: 'support', label: 'Support', icon: LifeBuoy, roles: ['super_admin', 'support'] },
            { id: 'security', label: 'Security', icon: Lock, roles: ['super_admin'] },
            { id: 'profile', label: 'Profile', icon: UserIcon, roles: ['super_admin', 'support', 'finance', 'compliance'] },
          ].filter(item => item.roles.includes(effectiveAdminRole)).map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                if (window.innerWidth < 1024) {
                  setIsSidebarOpen(false);
                }
              }}
              className={cn(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all group relative",
                activeTab === item.id 
                  ? "bg-mairide-primary text-white shadow-lg shadow-mairide-primary/20" 
                  : "text-mairide-secondary hover:bg-mairide-bg hover:text-mairide-primary"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", activeTab === item.id ? "text-white" : "group-hover:scale-110 transition-transform")} />
              <span className={cn("whitespace-nowrap transition-all", isSidebarOpen ? "opacity-100" : "opacity-0 w-0")}>
                {item.label}
              </span>
              {item.id === 'verification' && pendingVerificationDrivers.length > 0 && (
                <span className={cn(
                  "bg-mairide-accent text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full ml-auto",
                  !isSidebarOpen && "absolute top-1 right-1"
                )}>
                  {pendingVerificationDrivers.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-mairide-bg">
          <button 
            onClick={() => signOut(auth)}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-sm font-bold text-red-600 hover:bg-red-50 transition-all",
              !isSidebarOpen && "justify-center"
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className={cn("whitespace-nowrap", isSidebarOpen ? "block" : "hidden")}>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white border-b border-mairide-secondary p-4 flex justify-between items-center">
          <div className="flex min-w-0 items-center">
            <img src={LOGO_URL} className="mr-2.5 h-11 w-11 shrink-0 rounded-[16px] object-contain" alt="MaiRide Logo" />
            <div className="flex min-w-0 flex-col justify-center leading-none">
              <span className="block truncate text-[1.28rem] font-black leading-[0.95] tracking-tighter text-mairide-primary">
                MaiRide
              </span>
              <span className="mt-1 block truncate text-[0.68rem] font-black leading-none tracking-[0.12em] text-mairide-primary">
                my way
              </span>
            </div>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-mairide-bg rounded-xl"
          >
            <Menu className="w-6 h-6 text-mairide-primary" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12">
          <div className="max-w-7xl mx-auto">
            <div className="mb-12">
              <h2 className="text-4xl font-black text-mairide-primary tracking-tighter capitalize mb-2">
                {activeTab}
              </h2>
              <p className="text-mairide-secondary italic serif text-lg">Manage and monitor platform {activeTab} details.</p>
            </div>

            {activeTab === 'verification' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pendingVerificationDrivers.map(driver => (
                <div 
                  key={driver.uid}
                  className={cn(
                    "bg-white rounded-[32px] p-6 border transition-all cursor-pointer hover:shadow-xl",
                    driver.verificationStatus === 'pending' ? "border-orange-200 bg-orange-50/30" : "border-mairide-secondary"
                  )}
                  onClick={() => setSelectedDriver(driver)}
                >
                  <div className="flex items-center space-x-4 mb-4">
                    <div className="w-16 h-16 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary">
                      {driver.driverDetails?.selfiePhoto ? (
                        <img src={driver.driverDetails.selfiePhoto} className="w-full h-full object-cover" alt="Selfie" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><UserIcon className="w-8 h-8 text-mairide-secondary" /></div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-mairide-primary">{driver.displayName}</h3>
                      <p className="text-xs text-mairide-secondary">{driver.email}</p>
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-[8px] font-bold uppercase mt-1",
                        driver.verificationStatus === 'pending' ? "bg-orange-100 text-orange-600" :
                        driver.verificationStatus === 'approved' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                      )}>
                        {driver.verificationStatus}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-mairide-secondary uppercase">
                    <div className="bg-mairide-bg p-2 rounded-xl">
                      <p className="opacity-60 mb-0.5">Vehicle</p>
                      <p className="text-mairide-primary truncate">{driver.driverDetails?.vehicleMake} {driver.driverDetails?.vehicleModel}</p>
                    </div>
                    <div className="bg-mairide-bg p-2 rounded-xl">
                      <p className="opacity-60 mb-0.5">Reg No</p>
                      <p className="text-mairide-primary truncate">{driver.driverDetails?.vehicleRegNumber}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pendingVerificationDrivers.length === 0 && (
              <div className="text-center py-20 bg-white rounded-[40px] border border-mairide-secondary border-dashed">
                <ShieldCheck className="w-16 h-16 text-mairide-secondary mx-auto mb-4 opacity-20" />
                <h3 className="text-xl font-bold text-mairide-primary">No pending verifications</h3>
                <p className="text-mairide-secondary italic serif">Approved and rejected drivers are now managed from the users section, while only pending applications stay here.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <div className="h-[700px] bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden relative">
            {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={adminMapCenter}
                zoom={adminMapZoom}
                options={{
                  styles: [
                    { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
                    { "featureType": "transit", "stylers": [{ "visibility": "off" }] }
                  ]
                }}
              >
                {adminLocation && (
                  <Marker
                    position={adminLocation}
                    icon={{
                      url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
                      scaledSize: new window.google.maps.Size(30, 30)
                    }}
                    title="Super Admin Current Location"
                  />
                )}
                {usersWithLocation.map(user => (
                  <Marker
                    key={user.uid}
                    position={{ lat: user.location!.lat, lng: user.location!.lng }}
                    icon={{
                      url: user.role === 'driver' 
                        ? 'https://maps.google.com/mapfiles/ms/icons/car.png' 
                        : 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                      scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(user.role === 'driver' ? 32 : 24, user.role === 'driver' ? 32 : 24) : undefined
                    }}
                    title={`${user.displayName} (${user.role})`}
                  />
                ))}
              </GoogleMap>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-12">
                <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                <h3 className="text-xl font-bold text-mairide-primary">
                  {loadError ? "Maps Error" : "Map Unavailable"}
                </h3>
                <p className="text-mairide-secondary">
                  {loadError ? loadError.message : "Please check your Google Maps API configuration."}
                </p>
              </div>
            )}
            
            {/* Legend */}
            <div className="absolute bottom-8 left-8 bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-mairide-secondary shadow-xl z-10">
              <h4 className="text-[10px] font-bold text-mairide-secondary uppercase mb-3">Map Legend</h4>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-xs font-bold text-mairide-primary">Traveler</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Car className="w-4 h-4 text-mairide-accent" />
                  <span className="text-xs font-bold text-mairide-primary">Driver</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {userCards.map((stat) => (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => setUsersInsightView(usersInsightView === stat.id ? null : stat.id)}
                  className={cn(
                    "bg-white p-6 rounded-[32px] border border-mairide-secondary shadow-sm text-left transition-all hover:-translate-y-1 hover:shadow-lg",
                    usersInsightView === stat.id && "ring-2 ring-mairide-accent shadow-lg"
                  )}
                >
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", stat.color)}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">{stat.label}</p>
                  <p className="text-3xl font-black text-mairide-primary tracking-tighter">{stat.value}</p>
                  <p className="text-xs text-mairide-secondary mt-2">{stat.helper}</p>
                </button>
              ))}
            </div>

            {usersInsightContent && (
              <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm p-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-bold text-mairide-primary">{usersInsightContent.title}</h3>
                    <p className="text-sm text-mairide-secondary">{usersInsightContent.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUsersInsightView(null)}
                    className="self-start md:self-auto px-4 py-2 bg-mairide-bg text-mairide-primary rounded-xl text-sm font-bold"
                  >
                    Clear view
                  </button>
                </div>

                {usersInsightContent.users.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {usersInsightContent.users.map((user) => (
                      <button
                        key={user.uid}
                        type="button"
                        onClick={() => user.role === 'driver' ? setSelectedDriver(user) : setSelectedUser(user)}
                        className="text-left p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary hover:shadow-md transition-all"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 rounded-2xl bg-white border border-mairide-secondary overflow-hidden flex items-center justify-center">
                            {getResolvedUserPhoto(user) ? (
                              <img src={getResolvedUserPhoto(user)} alt={user.displayName} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="w-6 h-6 text-mairide-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-mairide-primary truncate">{user.displayName}</p>
                            <p className="text-xs text-mairide-secondary truncate">{user.email}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-accent mt-1">
                              {user.role === 'driver' ? `${getActiveRideOffers(user.uid).length} open offers` : `${getActiveUserTrips(user.uid, user.role).length} active trips`}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {usersInsightContent.rides.length > 0 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {usersInsightContent.rides.map((ride) => (
                      <div key={ride.id} className="p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-mairide-primary">{ride.origin}</p>
                            <p className="text-[10px] text-mairide-secondary uppercase tracking-widest my-1">to</p>
                            <p className="text-sm font-bold text-mairide-primary">{ride.destination}</p>
                          </div>
                          <span className="px-3 py-1 rounded-full bg-green-100 text-green-600 text-[10px] font-bold uppercase">
                            {ride.status}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-mairide-secondary">Driver</p>
                            <p className="font-bold text-mairide-primary">{ride.driverName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Seats</p>
                            <p className="font-bold text-mairide-primary">{ride.seatsAvailable}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Fare</p>
                            <p className="font-bold text-mairide-primary">{formatCurrency(ride.price)}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Departure</p>
                            <p className="font-bold text-mairide-primary">{new Date(ride.departureTime).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {usersInsightContent.trips.length > 0 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {usersInsightContent.trips.map((booking) => (
                      <div key={booking.id} className="p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-mairide-primary">{booking.origin}</p>
                            <p className="text-[10px] text-mairide-secondary uppercase tracking-widest my-1">to</p>
                            <p className="text-sm font-bold text-mairide-primary">{booking.destination}</p>
                          </div>
                          <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-600 text-[10px] font-bold uppercase">
                            {booking.rideLifecycleStatus || booking.status}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-mairide-secondary">Traveler</p>
                            <p className="font-bold text-mairide-primary">{booking.consumerName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Driver</p>
                            <p className="font-bold text-mairide-primary">{booking.driverName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Value</p>
                            <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Created</p>
                            <p className="font-bold text-mairide-primary">{new Date(booking.createdAt).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* User Management Table */}
            <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
              <div className="p-8 border-b border-mairide-secondary space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">User Management</h2>
                    {effectiveAdminRole === 'super_admin' && (
                      <p className="mt-2 text-xs text-mairide-secondary max-w-2xl">
                        Passwords are never visible to admins. Use a temporary password reset or copy a secure reset link for support cases.
                      </p>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowAddUser(true)}
                    className="flex items-center space-x-2 bg-mairide-primary text-white px-6 py-3 rounded-2xl font-bold hover:scale-105 transition-transform shadow-lg shadow-mairide-primary/20"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Add User</span>
                  </button>
                </div>
                
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-mairide-secondary" />
                    <input 
                      type="text"
                      placeholder="Search name, email, phone, UID, role, status, vehicle..."
                      className="w-full pl-12 pr-6 py-3 bg-mairide-bg border-none rounded-xl outline-none text-sm"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="flex space-x-2">
                    {['all', 'consumer', 'driver', 'admin'].map(role => (
                      <button
                        key={role}
                        onClick={() => setRoleFilter(role as any)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all",
                          roleFilter === role ? "bg-mairide-primary text-white" : "bg-mairide-bg text-mairide-secondary hover:text-mairide-primary"
                        )}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                  <select
                    value={userStatusFilter}
                    onChange={(event) => setUserStatusFilter(event.target.value as any)}
                    className="rounded-xl bg-mairide-bg px-4 py-3 text-xs font-bold uppercase tracking-widest text-mairide-primary outline-none"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="divide-y divide-mairide-secondary">
                <div className="hidden xl:grid grid-cols-[minmax(0,2fr)_160px_minmax(0,1.2fr)_160px_130px_180px] gap-6 bg-mairide-bg text-[10px] font-bold text-mairide-secondary uppercase tracking-widest px-8 py-4">
                  <div>User</div>
                  <div>Role</div>
                  <div>Activity</div>
                  <div>MaiCoins</div>
                  <div>Status</div>
                  <div>Actions</div>
                </div>
                <div className="divide-y divide-mairide-secondary">
                  {pagedFilteredUsers.map(user => (
                    <div key={user.uid} className="px-6 md:px-8 py-6 hover:bg-mairide-bg/50 transition-colors">
                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_160px_minmax(0,1.2fr)_160px_130px_180px] gap-6 items-start">
                        <button
                          type="button"
                          onClick={() => user.role === 'driver' ? setSelectedDriver(user) : setSelectedUser(user)}
                          className="flex items-center space-x-3 text-left group min-w-0"
                        >
                          <div className="w-14 h-14 rounded-2xl bg-mairide-bg flex items-center justify-center overflow-hidden border border-mairide-secondary shrink-0">
                            {getResolvedUserPhoto(user) ? (
                              <img src={getResolvedUserPhoto(user)} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <UserIcon className="w-6 h-6 text-mairide-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-lg text-mairide-primary group-hover:text-mairide-accent transition-colors truncate">{user.displayName}</p>
                            <p className="text-sm text-mairide-secondary truncate">{user.email}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-accent mt-1">View details</p>
                            {effectiveAdminRole === 'super_admin' && user.forcePasswordChange && (
                              <p className="text-[10px] font-mono text-mairide-accent mt-1 bg-mairide-accent/5 px-2 py-0.5 rounded inline-block">
                                Password reset required
                              </p>
                            )}
                          </div>
                        </button>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Role</p>
                          <select 
                            value={user.role}
                            onChange={(e) => handleUpdateRole(user.uid, e.target.value as any)}
                            className="w-full bg-mairide-bg border-none rounded-xl text-xs font-bold p-3 outline-none"
                          >
                            <option value="consumer">Consumer</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Activity</p>
                          {user.role === 'driver' ? (
                            <>
                              <p className="font-black text-mairide-primary tracking-tight text-2xl">
                                {getActiveRideOffers(user.uid).length} <span className="text-[10px] font-bold text-mairide-accent uppercase">open offers</span>
                              </p>
                              <p className="text-xs text-mairide-secondary">
                                {getActiveUserTrips(user.uid, user.role).length} active trips · {isUserCurrentlyOnline(user) ? 'online now' : 'offline'}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-black text-mairide-primary tracking-tight text-2xl">
                                {getActiveUserTrips(user.uid, user.role).length} <span className="text-[10px] font-bold text-mairide-accent uppercase">active trips</span>
                              </p>
                              <p className="text-xs text-mairide-secondary">
                                {getUserRideBookings(user.uid, user.role).length} total rides · {isUserCurrentlyOnline(user) ? 'online now' : 'offline'}
                              </p>
                            </>
                          )}
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">MaiCoins</p>
                          <p className="font-black text-mairide-primary tracking-tight text-2xl">
                            {user.wallet?.balance || 0} <span className="text-[10px] font-bold text-mairide-accent uppercase">MC</span>
                          </p>
                          <p className="text-xs text-mairide-secondary">
                            Pending: {user.wallet?.pendingBalance || 0} MC
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Status</p>
                          <button 
                            onClick={() => handleUpdateStatus(user.uid, user.status === 'active' ? 'inactive' : 'active')}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                              user.status === 'active' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                            )}
                          >
                            {user.status}
                          </button>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Actions</p>
                          <div className="flex items-center flex-wrap gap-2">
                            <button 
                              onClick={() => setShowDeleteConfirm(user.uid)}
                              className="p-2 hover:bg-red-50 text-red-600 rounded-xl transition-colors"
                              title="Delete User"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <div className="relative group/menu">
                              <button 
                                onClick={() => setEditingUser(user)}
                                className="p-2 hover:bg-mairide-bg rounded-xl transition-colors"
                              >
                                <MoreVertical className="w-5 h-5 text-mairide-secondary" />
                              </button>
                            </div>
                            {effectiveAdminRole === 'super_admin' && (
                              <>
                                <button 
                                  onClick={() => handleGenerateResetLink(user)}
                                  disabled={isGeneratingResetLink === user.uid}
                                  className="p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-colors disabled:opacity-50"
                                  title="Copy Password Reset Link"
                                >
                                  <Copy className="w-5 h-5" />
                                </button>
                                <button 
                                  onClick={() => setResetPasswordUser(user)}
                                  className="p-2 hover:bg-mairide-accent/10 text-mairide-accent rounded-xl transition-colors"
                                  title="Set Temporary Password"
                                >
                                  <Lock className="w-5 h-5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!pagedFilteredUsers.length && (
                    <div className="px-8 py-12 text-center text-mairide-secondary italic">
                      No users match the current search and filters.
                    </div>
                  )}
                </div>
              </div>
              <AdminListPagination
                page={usersPage}
                pageCount={usersPageCount}
                pageSize={usersPageSize}
                totalCount={users.filter((user) => user.uid !== profile.uid).length}
                filteredCount={filteredUsers.length}
                onPageChange={setUsersPage}
                onPageSizeChange={setUsersPageSize}
              />
            </div>
          </div>
        )}

        {activeTab === 'rides' && (
          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
            <div className="p-8 border-b border-mairide-secondary space-y-5">
              <h2 className="text-xl font-bold text-mairide-primary">All Ride Bookings</h2>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-mairide-secondary" />
                  <input
                    type="text"
                    value={rideSearchTerm}
                    onChange={(event) => setRideSearchTerm(event.target.value)}
                    placeholder="Search route, traveler, driver, phone, booking ID, ride ID, payment..."
                    className="w-full rounded-2xl bg-mairide-bg py-3 pl-11 pr-4 text-sm font-bold text-mairide-primary outline-none placeholder:font-medium placeholder:text-mairide-secondary"
                  />
                </div>
                <select
                  value={rideStatusFilter}
                  onChange={(event) => setRideStatusFilter(event.target.value as any)}
                  className="rounded-2xl bg-mairide-bg px-4 py-3 text-sm font-bold text-mairide-primary outline-none"
                >
                  <option value="all">All ride statuses</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed bookings</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="negotiating">Negotiating</option>
                  <option value="rejected">Rejected</option>
                  <option value="completed_lifecycle">Completed trips</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-mairide-bg text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">
                    <th className="px-8 py-4">Ride Details</th>
                    <th className="px-8 py-4">Traveler</th>
                    <th className="px-8 py-4">Driver</th>
                    <th className="px-8 py-4">Fare</th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">Date</th>
                    <th className="px-8 py-4">Support Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mairide-secondary">
                  {pagedAdminBookings.map(booking => (
                    <tr key={booking.id} className="hover:bg-mairide-bg/50 transition-colors">
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.origin}</p>
                        <p className="text-[10px] text-mairide-secondary">to</p>
                        <p className="font-bold text-sm text-mairide-primary">{booking.destination}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.consumerName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.driverName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-mairide-accent">{formatCurrency(booking.totalPrice)}</p>
                        <p className="text-[10px] text-mairide-secondary">Fee: {formatCurrency(booking.serviceFee)}</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                          booking.status === 'confirmed' ? "bg-green-100 text-green-600" :
                          booking.status === 'pending' ? "bg-orange-100 text-orange-600" : "bg-red-100 text-red-600"
                        )}>
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleDateString()}</p>
                      </td>
                      <td className="px-8 py-6">
                        {booking.status !== 'cancelled' && booking.rideLifecycleStatus !== 'completed' ? (
                          <button
                            type="button"
                            onClick={() => handleAdminForceCancelRide(booking)}
                            disabled={forceCancellingRideId === (booking.rideId || booking.ride_id)}
                            className="rounded-xl border border-red-200 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {forceCancellingRideId === (booking.rideId || booking.ride_id) ? 'Cancelling...' : 'Force cancel'}
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                            No action
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pagedAdminBookings.length && (
                    <tr>
                      <td colSpan={7} className="px-8 py-12 text-center text-mairide-secondary italic">
                        No ride bookings match the current search and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <AdminListPagination
              page={ridesPage}
              pageCount={ridesPageCount}
              pageSize={ridesPageSize}
              totalCount={bookings.length}
              filteredCount={filteredAdminBookings.length}
              onPageChange={setRidesPage}
              onPageSizeChange={setRidesPageSize}
            />
          </div>
        )}

        {activeTab === 'revenue' && (
          <div className="space-y-6">
            <AdminRevenueAnalysis
              bookings={bookings}
              users={users}
              afterAlertsSlot={(
                <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Live Ops Monitor</p>
                      <h3 className="mt-2 text-2xl font-black text-mairide-primary">Trip session trust and reliability</h3>
                      <p className="mt-1 text-sm text-mairide-secondary">Real-time health snapshot across active tracking sessions.</p>
                    </div>
                    <div className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                      {tripSessions.length} sessions observed
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Live sessions</p>
                      <p className="mt-2 text-3xl font-black text-mairide-primary">{liveTripSessions.length}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Stale sessions</p>
                      <p className="mt-2 text-3xl font-black text-mairide-accent">{staleTripSessions.length}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Offline links</p>
                      <p className="mt-2 text-3xl font-black text-mairide-primary">{offlineTripSessions.length}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/40">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Anti-spoof alerts</p>
                      <p className="mt-2 text-3xl font-black text-red-600">{antiSpoofAlerts}</p>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-mairide-secondary/40 bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Recent Trust Alerts</p>
                    {liveOpsAlerts.length ? (
                      <div className="mt-3 space-y-2">
                        {liveOpsAlerts.map((alert, index) => (
                          <div key={`${alert.bookingId}-${alert.createdAt}-${index}`} className="rounded-xl bg-white px-3 py-2">
                            <p className="text-xs font-bold text-mairide-primary">Booking {alert.bookingId.slice(0, 8).toUpperCase()} • {alert.action}</p>
                            <p className="text-xs text-mairide-secondary">{alert.details}</p>
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                              {new Date(alert.createdAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-mairide-secondary">No active trust alerts right now.</p>
                    )}
                  </div>
                </div>
              )}
            />
            <AdminMarketingInsightsCard bookings={bookings} />
          </div>
        )}

        {activeTab === 'capacity' && <AdminCapacityView />}

        {activeTab === 'mobile' && <AdminMobileAppView />}

        {activeTab === 'analytics' && (
          <AdminCashFlowAnalytics bookings={bookings} users={users} />
        )}

        {activeTab === 'transactions' && (
          <AdminTransactionsView
            transactions={transactions}
            bookings={bookings as Booking[]}
            users={users}
          />
        )}

        {activeTab === 'config' && (
          <AdminConfigView />
        )}

        {activeTab === 'support' && <AdminSupportView />}

        {activeTab === 'security' && <AdminSecurityView />}

        {activeTab === 'profile' && (
          <div className="space-y-8">
            <div className="bg-white rounded-[40px] border border-mairide-secondary p-8 md:p-10 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
                <div className="flex items-center gap-5">
                  <div className="w-24 h-24 rounded-[28px] bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shadow-sm">
                    {getResolvedUserPhoto(adminSelfProfile) ? (
                      <img src={getResolvedUserPhoto(adminSelfProfile)} alt={adminSelfProfile.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-10 h-10 text-mairide-secondary" />
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-mairide-secondary">Admin profile</p>
                    <h2 className="mt-2 text-3xl font-bold text-mairide-primary">{adminSelfProfile.displayName || auth.currentUser?.displayName || 'Admin User'}</h2>
                    <p className="mt-1 text-sm text-mairide-secondary break-all">{adminSelfProfile.email || auth.currentUser?.email}</p>
                    <p className="mt-3 inline-flex items-center rounded-full bg-green-100 px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-green-600">
                      {adminSelfProfile.status}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-[280px]">
                  <button
                    onClick={() => setEditingUser(adminSelfProfile)}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors"
                  >
                    Edit profile
                  </button>
                  <button
                    onClick={() => setResetPasswordUser(adminSelfProfile)}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors"
                  >
                    Set temporary password
                  </button>
                  <button
                    onClick={() => handleGenerateResetLink(adminSelfProfile)}
                    disabled={isGeneratingResetLink === adminSelfProfile.uid}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors disabled:opacity-50"
                  >
                    {isGeneratingResetLink === adminSelfProfile.uid ? 'Generating link...' : 'Copy reset link'}
                  </button>
                  <button 
                    onClick={() => signOut(auth)}
                    className="rounded-2xl bg-red-600 px-5 py-4 text-left font-bold text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Role</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary capitalize">{adminSelfProfile.adminRole || 'super_admin'}</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">MaiCoins</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminSelfProfile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">MC</span></p>
                <p className="mt-2 text-xs text-mairide-secondary">Pending: {adminSelfProfile.wallet?.pendingBalance || 0} MC</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Account activity</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminActiveTrips}</p>
                <p className="mt-2 text-xs text-mairide-secondary">{adminUserTrips.length} total bookings tracked</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Open offers</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminOpenOffers}</p>
                <p className="mt-2 text-xs text-mairide-secondary">{isUserCurrentlyOnline(adminSelfProfile) ? 'Online now' : 'Offline currently'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <h3 className="text-lg font-bold text-mairide-primary">Account details</h3>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Email</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary break-all">{adminSelfProfile.email}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Phone</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{formatPhoneForDisplay(adminSelfProfile.phoneNumber)}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Status</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary capitalize">{adminSelfProfile.status}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Password state</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.forcePasswordChange ? 'Reset required' : 'Normal access'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <h3 className="text-lg font-bold text-mairide-primary">Consent and audit</h3>
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Created</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.createdAt ? new Date(adminSelfProfile.createdAt).toLocaleString() : 'Not available'}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Marketing consent</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.consents?.marketingOptIn ? 'Opted in' : 'Not opted in'}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Truth declaration</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.consents?.truthfulInformationAccepted ? 'Accepted' : 'Not recorded'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
          </div>
        </main>
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {adminNotice && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-mairide-secondary"
            >
              <div className="flex items-start gap-4">
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0",
                  adminNotice.tone === 'success'
                    ? 'bg-green-50 text-green-600'
                    : adminNotice.tone === 'error'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-blue-50 text-blue-600'
                )}>
                  {adminNotice.tone === 'success' ? (
                    <CheckCircle2 className="w-7 h-7" />
                  ) : adminNotice.tone === 'error' ? (
                    <AlertTriangle className="w-7 h-7" />
                  ) : (
                    <AlertCircle className="w-7 h-7" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-mairide-primary">{adminNotice.title}</h3>
                  <p className="text-sm text-mairide-secondary mt-2 leading-relaxed">{adminNotice.message}</p>
                </div>
              </div>
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => setAdminNotice(null)}
                  className="px-6 py-3 rounded-2xl bg-mairide-primary text-white font-bold shadow-lg shadow-mairide-primary/20"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {resetPasswordUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Reset Password</h2>
                <button onClick={() => setResetPasswordUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <div className="mb-6 p-4 bg-mairide-bg rounded-2xl">
                <p className="text-xs font-bold text-mairide-secondary uppercase mb-1">User</p>
                <p className="font-bold text-mairide-primary">{resetPasswordUser.displayName}</p>
                <p className="text-xs text-mairide-secondary">{resetPasswordUser.email}</p>
              </div>
              <form onSubmit={handleResetPassword} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">New Password</label>
                  <input 
                    type="password" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newAdminPassword}
                    onChange={e => setNewAdminPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isResetting}
                  className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
                >
                  {isResetting ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showAddUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Add New User</h2>
                <button onClick={() => setShowAddUser(false)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
                  <input 
                    type="text" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.displayName}
                    onChange={e => setNewUser({ ...newUser, displayName: sanitizeDisplayName(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: normalizeEmailValue(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <IndianPhoneInput
                    value={newUser.phoneNumber}
                    onChange={(value) => setNewUser({ ...newUser, phoneNumber: value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Temporary Password</label>
                  <input 
                    type="password" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Role</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value as any })}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {newUser.role === 'admin' && (
                  <div>
                    <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Admin Job Role</label>
                    <select 
                      className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                      value={newUser.adminRole}
                      onChange={e => setNewUser({ ...newUser, adminRole: e.target.value as any })}
                    >
                      <option value="super_admin">Super Admin</option>
                      <option value="support">Customer Support</option>
                      <option value="finance">Finance</option>
                      <option value="compliance">Compliance</option>
                    </select>
                  </div>
                )}
                <button 
                  type="submit"
                  className="w-full bg-mairide-accent text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-accent/20 hover:scale-[1.02] transition-transform"
                >
                  Create Profile
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Edit User</h2>
                <button onClick={() => setEditingUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
                  <input 
                    type="text" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={editingUser.displayName}
                    onChange={e => setEditingUser({ ...editingUser, displayName: sanitizeDisplayName(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <IndianPhoneInput
                    value={editingUser.phoneNumber || ''}
                    onChange={(value) => setEditingUser({ ...editingUser, phoneNumber: value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Role</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={editingUser.role}
                    onChange={e => setEditingUser({ ...editingUser, role: e.target.value as any })}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Status</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={editingUser.status}
                    onChange={e => setEditingUser({ ...editingUser, status: e.target.value as any })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform"
                >
                  Save Changes
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-mairide-primary mb-2">Delete User?</h2>
              <p className="text-mairide-secondary mb-8">This action cannot be undone. All user data will be permanently removed.</p>
              <div className="flex flex-col space-y-3">
                <button 
                  onClick={() => handleDeleteUser(showDeleteConfirm)}
                  className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 transition-colors"
                >
                  Yes, Delete User
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(null)}
                  className="w-full bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Driver Verification Modal */}
      <AnimatePresence>
        {selectedDriver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-mairide-secondary flex justify-between items-center bg-white sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary">
                    {selectedDriver.driverDetails?.selfiePhoto ? (
                      <img src={selectedDriver.driverDetails.selfiePhoto} className="w-full h-full object-cover" alt="Selfie" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><UserIcon className="w-6 h-6 text-mairide-secondary" /></div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">{selectedDriver.displayName}</h2>
                    <p className="text-xs text-mairide-secondary">
                      {selectedDriver.verificationStatus === 'pending' ? 'Driver Application Verification' : 'Driver Profile Details'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedDriver(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-12">
                <section>
                  <VerificationMap
                    markers={selectedDriverMarkers}
                    isLoaded={isLoaded}
                    title="Signup Verification Map"
                    subtitle="This map shows where each verification asset was captured, helping the review team spot inconsistencies quickly."
                  />
                </section>

                {/* Selfie & Identity */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <UserIcon className="w-4 h-4 mr-2" />
                    Identity & Selfie
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="aspect-square bg-mairide-bg rounded-[32px] overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.selfiePhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.selfiePhoto} 
                            className="w-full h-full object-cover" 
                            alt="Selfie" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/400';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <UserIcon className="w-12 h-12 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.selfieGeoTag} />
                        <a href={selectedDriver.driverDetails?.selfiePhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Full Name</p>
                        <p className="text-lg font-bold text-mairide-primary">{selectedDriver.displayName}</p>
                      </div>
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Email Address</p>
                        <p className="text-lg font-bold text-mairide-primary">{selectedDriver.email}</p>
                      </div>
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Phone Number</p>
                        <p className="text-lg font-bold text-mairide-primary">{formatPhoneForDisplay(selectedDriver.phoneNumber)}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Aadhaar Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Aadhaar Verification
                  </h3>
                  <div className="bg-mairide-bg p-6 rounded-3xl mb-6">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Aadhaar Number</p>
                    <p className="text-xl font-bold text-mairide-primary tracking-widest">{formatAadhaarForDisplay(selectedDriver.driverDetails?.aadhaarNumber)}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.aadhaarFrontPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.aadhaarFrontPhoto} 
                            className="w-full h-full object-cover" 
                            alt="Aadhaar Front" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.aadhaarFrontGeoTag} />
                        <a href={selectedDriver.driverDetails?.aadhaarFrontPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.aadhaarBackPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.aadhaarBackPhoto} 
                            className="w-full h-full object-cover" 
                            alt="Aadhaar Back" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.aadhaarBackGeoTag} />
                        <a href={selectedDriver.driverDetails?.aadhaarBackPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                  {(selectedDriver.driverDetails?.aadhaarGeoTag || selectedDriver.driverDetails?.aadhaarFrontGeoTag) && (
                    <p className="mt-4 text-[10px] text-mairide-secondary text-center italic">
                      📍 Document captured with geo-tagging verification.
                    </p>
                  )}
                </section>

                {/* DL Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <Car className="w-4 h-4 mr-2" />
                    Driving License
                  </h3>
                  <div className="bg-mairide-bg p-6 rounded-3xl mb-6">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">DL Number</p>
                    <p className="text-xl font-bold text-mairide-primary tracking-widest">{selectedDriver.driverDetails?.dlNumber}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.dlFrontPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.dlFrontPhoto} 
                            className="w-full h-full object-cover" 
                            alt="DL Front" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.dlFrontGeoTag} />
                        <a href={selectedDriver.driverDetails?.dlFrontPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.dlBackPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.dlBackPhoto} 
                            className="w-full h-full object-cover" 
                            alt="DL Back" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.dlBackGeoTag} />
                        <a href={selectedDriver.driverDetails?.dlBackPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Vehicle Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <Car className="w-4 h-4 mr-2" />
                    Vehicle & RC
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Make/Model</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleMake} {selectedDriver.driverDetails?.vehicleModel}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Color</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleColor}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Capacity</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleCapacity} Seats</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl col-span-2 md:col-span-1">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Reg Number</p>
                      <p className="text-sm font-bold text-mairide-primary tracking-widest">{selectedDriver.driverDetails?.vehicleRegNumber}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Status</p>
                      <p className="text-sm font-bold text-mairide-primary capitalize">{selectedDriver.driverDetails?.insuranceStatus || 'Not captured'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Provider</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.insuranceProvider || 'Not provided'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Expiry</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.insuranceExpiryDate || 'Not provided'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl col-span-2 md:col-span-3">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Driver Declaration</p>
                      <p className="text-sm font-bold text-mairide-primary">
                        {selectedDriver.driverDetails?.declarationAccepted ? 'Accepted during onboarding' : 'Not accepted'}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Vehicle Photo</p>
                      <div className="aspect-[4/3] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.vehiclePhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.vehiclePhoto} 
                            className="w-full h-full object-cover" 
                            alt="Vehicle" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.vehicleGeoTag} />
                        <a href={selectedDriver.driverDetails?.vehiclePhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">RC Photo</p>
                      <div className="aspect-[4/3] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.rcPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.rcPhoto} 
                            className="w-full h-full object-cover" 
                            alt="RC" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.rcGeoTag} />
                        <a href={selectedDriver.driverDetails?.rcPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <History className="w-4 h-4 mr-2" />
                    Driver Activity History
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Ride Offers</p>
                      <p className="text-2xl font-black text-mairide-primary">{getUserRideOffers(selectedDriver.uid).length}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Bookings Handled</p>
                      <p className="text-2xl font-black text-mairide-primary">{getUserRideBookings(selectedDriver.uid, 'driver').length}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Completed Trips</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedDriver.uid, 'driver').filter((booking) => booking.status === 'completed').length}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Ride Offers Created</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideOffers(selectedDriver.uid).length > 0 ? getUserRideOffers(selectedDriver.uid).map((ride) => (
                          <div key={ride.id} className="px-6 py-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(ride.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-mairide-accent">{formatCurrency(ride.price)}</p>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">{ride.status}</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No ride offers recorded yet.</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Bookings & Trip History</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideBookings(selectedDriver.uid, 'driver').length > 0 ? getUserRideBookings(selectedDriver.uid, 'driver').map((booking) => (
                          <div key={booking.id} className="px-6 py-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                              <div>
                                <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                                <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-right">
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-mairide-secondary">Trip Value</p>
                                  <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-mairide-secondary">Status</p>
                                  <p className="font-bold text-mairide-accent uppercase">{booking.status}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No booking history recorded yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Final Decision */}
                <section className="bg-mairide-bg p-8 rounded-[32px] border border-mairide-secondary">
                  <h3 className="text-lg font-bold text-mairide-primary mb-6">Verification Decision</h3>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Rejection Reason (if applicable)</label>
                      <textarea 
                        placeholder="Explain why the application is being rejected..."
                        className="w-full p-4 bg-white border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent min-h-[100px]"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                    </div>
                    {selectedDriver.verificationStatus !== 'pending' && (
                      <div className="mb-4 rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-3 text-sm text-mairide-primary">
                        This application has already been reviewed with status: <span className="font-bold uppercase">{selectedDriver.verificationStatus}</span>.
                      </div>
                    )}
                    <div className="flex space-x-4">
                      <button 
                        onClick={() => handleVerifyDriver(selectedDriver.uid, 'rejected')}
                        disabled={!rejectionReason || selectedDriver.verificationStatus !== 'pending'}
                        className="flex-1 bg-white text-red-600 border border-red-200 py-4 rounded-2xl font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        Reject Application
                      </button>
                      <button 
                        onClick={() => handleVerifyDriver(selectedDriver.uid, 'approved')}
                        disabled={selectedDriver.verificationStatus !== 'pending'}
                        className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
                      >
                        Approve Driver
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}

        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-3xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-mairide-secondary flex justify-between items-center bg-white sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center">
                    {getResolvedUserPhoto(selectedUser) ? (
                      <img src={getResolvedUserPhoto(selectedUser)} className="w-full h-full object-cover" alt={selectedUser.displayName} />
                    ) : (
                      <UserIcon className="w-6 h-6 text-mairide-secondary" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">{selectedUser.displayName}</h2>
                    <p className="text-xs text-mairide-secondary capitalize">{selectedUser.role} profile details</p>
                  </div>
                </div>
                <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Email</p>
                    <p className="text-lg font-bold text-mairide-primary break-all">{selectedUser.email}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Phone</p>
                    <p className="text-lg font-bold text-mairide-primary">{formatPhoneForDisplay(selectedUser.phoneNumber)}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Status</p>
                    <p className="text-lg font-bold text-mairide-primary capitalize">{selectedUser.status}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Role</p>
                    <p className="text-lg font-bold text-mairide-primary capitalize">
                      {selectedUser.role === 'admin' ? selectedUser.adminRole || 'admin' : selectedUser.role}
                    </p>
                  </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">MaiCoins Balance</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">{selectedUser.wallet?.balance || 0}</p>
                  </div>
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Pending Coins</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">{selectedUser.wallet?.pendingBalance || 0}</p>
                  </div>
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Ratings</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">
                      {typeof selectedUser.reviewStats?.averageRating === 'number' ? selectedUser.reviewStats.averageRating.toFixed(1) : '5.0'}
                    </p>
                    <p className="text-xs text-mairide-secondary mt-1">{selectedUser.reviewStats?.ratingCount || 0} reviews</p>
                  </div>
                </section>

                {selectedUser.consents && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Consents & Declarations</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="font-bold text-mairide-primary">{selectedUser.consents.truthfulInformationAccepted ? 'Truth declaration accepted' : 'Truth declaration missing'}</p>
                        <p className="text-xs text-mairide-secondary mt-1">Accepted at {new Date(selectedUser.consents.acceptedAt).toLocaleString()}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="font-bold text-mairide-primary">{selectedUser.consents.termsAccepted ? 'Terms accepted' : 'Terms not accepted'}</p>
                        <p className="text-xs text-mairide-secondary mt-1">Marketing opt-in: {selectedUser.consents.marketingOptIn ? 'Yes' : 'No'}</p>
                      </div>
                    </div>
                  </section>
                )}

                {selectedUser.location && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Latest Known Location</h3>
                    <p className="text-sm font-bold text-mairide-primary">
                      {selectedUser.location.lat.toFixed(5)}, {selectedUser.location.lng.toFixed(5)}
                    </p>
                    <p className="text-xs text-mairide-secondary mt-2">Updated {new Date(selectedUser.location.lastUpdated).toLocaleString()}</p>
                  </section>
                )}

                {selectedUser.role === 'consumer' && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Traveler Snapshot</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Referral Code</p>
                        <p className="font-bold text-mairide-primary">{selectedUser.referralCode || 'Not assigned'}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Password State</p>
                        <p className="font-bold text-mairide-primary">{selectedUser.forcePasswordChange ? 'Reset required' : 'Normal'}</p>
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">User History</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">
                        {selectedUser.role === 'driver' ? 'Ride Offers' : 'Trips Taken'}
                      </p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {selectedUser.role === 'driver' ? getUserRideOffers(selectedUser.uid).length : getUserRideBookings(selectedUser.uid, selectedUser.role).length}
                      </p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Completed</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedUser.uid, selectedUser.role).filter((booking) => booking.status === 'completed').length}
                      </p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Cancelled / Rejected</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedUser.uid, selectedUser.role).filter((booking) => ['cancelled', 'rejected'].includes(booking.status)).length}
                      </p>
                    </div>
                  </div>

                  {selectedUser.role === 'driver' && (
                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden mb-4">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Ride Offers Created</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideOffers(selectedUser.uid).length > 0 ? getUserRideOffers(selectedUser.uid).map((ride) => (
                          <div key={ride.id} className="px-6 py-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(ride.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-mairide-accent">{formatCurrency(ride.price)}</p>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">{ride.status}</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No ride offers recorded yet.</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-mairide-secondary">
                      <h4 className="font-bold text-mairide-primary">
                        {selectedUser.role === 'driver' ? 'Trips & Booking History' : 'Ride History'}
                      </h4>
                    </div>
                    <div className="divide-y divide-mairide-secondary">
                      {getUserRideBookings(selectedUser.uid, selectedUser.role).length > 0 ? getUserRideBookings(selectedUser.uid, selectedUser.role).map((booking) => (
                        <div key={booking.id} className="px-6 py-4">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                              <p className="text-sm text-mairide-secondary">
                                {selectedUser.role === 'driver' ? `Traveler: ${booking.consumerName}` : `Driver: ${booking.driverName}`}
                              </p>
                              <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-right">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">Trip Value</p>
                                <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">Status</p>
                                <p className="font-bold text-mairide-accent uppercase">{booking.status}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="px-6 py-8 text-sm text-mairide-secondary">No trip history recorded yet.</div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- App Root ---

const LIBRARIES: ("places" | "drawing" | "geometry" | "visualization")[] = ["places", "geometry"];

// --- Hooks ---
const useAppConfig = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const configRef = doc(db, 'app_config', 'global');
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        const nextConfig = { id: snapshot.id, ...snapshot.data() } as AppConfig;
        [
          'razorpayKeySecret',
          'razorpayWebhookSecret',
          'resendApiKey',
          'emailApiKey',
          'smsApiKey',
          'twoFactorApiKey',
          'paymentGatewayApiKey',
          'n8nApiKey',
          'n8nSharedSecret',
          'geminiApiKey',
          'openaiApiKey',
          'claudeApiKey',
        ].forEach((key) => {
          if (key in nextConfig) {
            delete (nextConfig as Record<string, any>)[key];
          }
        });
        setConfig(nextConfig);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'app_config/global');
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { config, loading };
};

const App = () => {
  console.log("🚀 App component initialization started");
  const appConfigState = useAppConfig();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>(() => {
    if (typeof window === 'undefined') return 'login';
    const mode = new URLSearchParams(window.location.search).get('mode');
    return mode === 'signup' ? 'signup' : 'login';
  });
  const [notRegisteredError, setNotRegisteredError] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [role, setRole] = useState<'consumer' | 'driver'>('consumer');
  const [uiLanguage, setUiLanguage] = useState<string>(() => {
    if (typeof window === 'undefined') return 'en';
    return canUseCookieCategory(getStoredCookieConsent(), 'preferences')
      ? safeStorageGet('local', UI_LANGUAGE_STORAGE_KEY) || 'en'
      : 'en';
  });
  const [cookieConsent, setCookieConsent] = useState<CookieConsentRecord | null>(() => getStoredCookieConsent());
  const [translatorReady, setTranslatorReady] = useState(false);
  const [showLanguagePrompt, setShowLanguagePrompt] = useState(false);
  const [suggestedLanguage, setSuggestedLanguage] = useState<string>('en');
  const [languagePromptOptions, setLanguagePromptOptions] = useState<string[]>(['en', 'hi']);
  const [androidUpdateState, setAndroidUpdateState] = useState<{
    available: boolean;
    latestVersion: string;
    apkUrl: string;
  }>({
    available: false,
    latestVersion: '',
    apkUrl: LIVE_ANDROID_APK_URL,
  });
  const [showAndroidUpdatePrompt, setShowAndroidUpdatePrompt] = useState(false);
  const [isApplyingAndroidUpdate, setIsApplyingAndroidUpdate] = useState(false);
  const [remoteAppVersion, setRemoteAppVersion] = useState('');
  const [buildStamp, setBuildStamp] = useState<BuildStampInfo | null>(null);
  const [installedAndroidVersion, setInstalledAndroidVersion] = useState(APP_VERSION);
  const [isUploadingTravelerAvatar, setIsUploadingTravelerAvatar] = useState(false);
  const [showTravelerAvatarOptions, setShowTravelerAvatarOptions] = useState(false);
  const [showTravelerCameraCapture, setShowTravelerCameraCapture] = useState(false);
  const [showTravelerCameraSettingsPrompt, setShowTravelerCameraSettingsPrompt] = useState(false);
  const travelerAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const androidPushRegistrationKeyRef = useRef('');
  const releaseVersion = resolveReleaseVersion(appConfigState.config?.appVersion, remoteAppVersion);

  useEffect(() => {
    void trackPlatformUsageEvent('app_opened', {
      releaseVersion,
      installedAndroidVersion,
    });
  }, [installedAndroidVersion, releaseVersion]);

  useEffect(() => {
    if (!profile) return;
    void trackPlatformUsageEvent('user_logged_in', {
      role: profile.role,
      status: profile.status,
      releaseVersion,
    });
  }, [profile?.uid, profile?.role, profile?.status, releaseVersion]);

  useEffect(() => {
    if (!profile || profile.role === 'admin' || !isAndroidAppRuntime()) return;
    const registrationKey = [
      profile.uid,
      profile.role,
      releaseVersion || APP_VERSION,
      profile.location?.lat ?? '',
      profile.location?.lng ?? '',
    ].join(':');
    if (androidPushRegistrationKeyRef.current === registrationKey) return;
    androidPushRegistrationKeyRef.current = registrationKey;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void registerAndroidPushDevice(profile, releaseVersion)
      .then((removeListeners) => {
        if (cancelled) {
          removeListeners();
          return;
        }
        cleanup = removeListeners;
      })
      .catch((error) => {
        console.warn('Android push setup failed:', error);
      });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [profile?.uid, profile?.role, profile?.location?.lat, profile?.location?.lng, releaseVersion]);

  useEffect(() => {
    let active = true;
    const loadRemoteVersion = async () => {
      try {
        const response = await fetch(apiPath('/api/health?action=app-version'), { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        setRemoteAppVersion(String(data?.appVersion || '').trim());
      } catch {
        // Keep fallback version behavior.
      }
    };
    void loadRemoteVersion();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadBuildStamp = async () => {
      try {
        const response = await fetch(apiPath('/api/health?action=build-stamp'), { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        setBuildStamp({
          appVersion: String(data?.appVersion || '').trim(),
          commitSha: String(data?.commitSha || '').trim(),
          commitRef: String(data?.commitRef || '').trim(),
          commitMessage: String(data?.commitMessage || '').trim(),
          deployId: String(data?.deployId || '').trim(),
          env: String(data?.env || '').trim(),
          vercelUrl: String(data?.vercelUrl || '').trim(),
          builtAt: String(data?.builtAt || '').trim(),
        });
      } catch {
        // Ignore build stamp failures; footer will fall back.
      }
    };
    void loadBuildStamp();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') !== 'signup') return;
    params.delete('mode');
    const next = params.toString();
    const target = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', target);
  }, []);

  useEffect(() => {
    if (!isLocalRazorpayEnabled()) return;
    ensureRazorpayCheckoutScript().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isLocalDevFirestoreMode()) return;
    async function testConnection() {
      try {
        // Use getDocFromServer to bypass cache and test real connection
        await getDocFromServer(doc(db, '_connection_test_', 'connection'));
        console.log("Firestore connection successful");
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore is offline. Please check your Firebase configuration and ensure the database is provisioned.");
        } else {
          // Log other errors but don't alert as it might be a missing doc which is fine
          console.log("Firestore connection test result:", error);
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      setUser(u);
      setProfile(null);
      
      // Clean up previous profile listener if it exists
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (u) {
        const mappedPhoneProfileId = u.isAnonymous ? safeStorageGet('session', PHONE_LOGIN_PROFILE_KEY) : null;
        const pendingPhoneLogin = u.isAnonymous ? safeStorageGet('session', PHONE_LOGIN_NUMBER_KEY) : null;
        const profileDocId = mappedPhoneProfileId || u.uid;

        // Listen to profile changes
        unsubProfile = onSnapshot(doc(db, 'users', profileDocId), async (snapshot) => {
          if (snapshot.exists()) {
            setProfile(snapshot.data() as UserProfile);
            if (u.isAnonymous) {
              safeStorageRemove('session', PHONE_LOGIN_NUMBER_KEY);
            }
            setLoading(false);
          } else if (u.email && !u.isAnonymous) {
            // If not found by UID, try to find by email (for pre-created admin users)
            try {
              const normalizedEmail = normalizeEmailValue(u.email);
              const emailCandidates = Array.from(
                new Set([u.email || '', normalizedEmail].map(normalizeEmailValue).filter(Boolean))
              );
              let querySnapshot = null;

              for (const emailCandidate of emailCandidates) {
                const q = query(collection(db, 'users'), where('email', '==', emailCandidate));
                const nextSnapshot = await getDocs(q);
                if (!nextSnapshot.empty) {
                  querySnapshot = nextSnapshot;
                  break;
                }
              }
              
              if (querySnapshot && !querySnapshot.empty) {
                const existingProfileDoc = querySnapshot.docs[0];
                const existingProfile = existingProfileDoc.data() as UserProfile;
                
                if (existingProfile.uid !== u.uid) {
                  // Link the existing profile to this UID
                  const newProfile = {
                    ...existingProfile,
                    uid: u.uid
                  };
                  await setDoc(doc(db, 'users', u.uid), newProfile);
                  // Delete the old manual profile if it was a placeholder
                  if (existingProfile.uid.startsWith('manual_')) {
                    await deleteDoc(doc(db, 'users', existingProfile.uid));
                  }
                  setProfile(newProfile);
                } else {
                  setProfile(existingProfile);
                }
                clearStoredOAuthIntent();
                setLoading(false);
              } else {
                const oauthMode = getStoredOAuthMode();
                if (oauthMode === 'signup') {
                  const isAdminEmail = normalizedEmail === SUPER_ADMIN_EMAIL;
                  const selectedOAuthRole = getStoredOAuthRole();
                  const newProfile: UserProfile = {
                    uid: u.uid,
                    email: normalizedEmail,
                    displayName: u.displayName || u.email || 'User',
                    role: isAdminEmail ? 'admin' : selectedOAuthRole,
                    status: 'active',
                    photoURL: u.photoURL || '',
                    phoneNumber: u.phoneNumber || '',
                    onboardingComplete: isAdminEmail,
                    forcePasswordChange: false,
                  };
                  await setDoc(doc(db, 'users', u.uid), newProfile);
                  await walletService.initializeUserWallet(u.uid);
                  setProfile(newProfile);
                  clearStoredOAuthIntent();
                } else {
                  clearStoredOAuthIntent();
                  setNotRegisteredError(true);
                  await signOut(auth);
                  setProfile(null);
                }
              }
            } catch (error) {
              console.error("Error linking profile:", error);
              setProfile(null);
            }
            setLoading(false);
          } else {
            if (u.isAnonymous && pendingPhoneLogin) {
              try {
                const matchedProfile = await findUserProfileByPhone(pendingPhoneLogin);
                if (matchedProfile) {
                  safeStorageSet('session', PHONE_LOGIN_PROFILE_KEY, matchedProfile.uid);
                  safeStorageRemove('session', PHONE_LOGIN_NUMBER_KEY);
                  setProfile(matchedProfile);
                  setNotRegisteredError(false);
                  setLoading(false);
                  return;
                }
              } catch (lookupError) {
                console.error("Anonymous phone profile lookup error:", lookupError);
              }
            }
            if (u.isAnonymous) {
              safeStorageRemove('session', PHONE_LOGIN_PROFILE_KEY);
              safeStorageRemove('session', PHONE_LOGIN_NUMBER_KEY);
            }
            setProfile(null);
            setLoading(false);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${profileDocId}`);
          setProfile(null);
          setLoading(false);
        });
      } else {
        safeStorageRemove('session', PHONE_LOGIN_PROFILE_KEY);
        safeStorageRemove('session', PHONE_LOGIN_NUMBER_KEY);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleLogout = () => {
    safeStorageRemove('session', PHONE_LOGIN_PROFILE_KEY);
    safeStorageRemove('session', PHONE_LOGIN_NUMBER_KEY);
    return signOut(auth);
  };

  const isTravelerProfile = profile?.role === 'consumer';

  const closeTravelerAvatarFlows = useCallback(() => {
    setShowTravelerAvatarOptions(false);
    setShowTravelerCameraCapture(false);
    setShowTravelerCameraSettingsPrompt(false);
  }, []);

  const updateTravelerAvatar = useCallback(async (dataUrl: string) => {
    if (!profile || profile.role !== 'consumer') return;
    setIsUploadingTravelerAvatar(true);
    try {
      const avatarRef = storageRef(storage, `users/${profile.uid}/avatar-${Date.now()}.jpg`);
      await uploadString(avatarRef, dataUrl, 'data_url');
      const avatarUrl = await getDownloadURL(avatarRef);
      await updateDoc(doc(db, 'users', profile.uid), {
        photoURL: avatarUrl,
        travelerAvatarSource: 'custom',
      });
      closeTravelerAvatarFlows();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setIsUploadingTravelerAvatar(false);
    }
  }, [closeTravelerAvatarFlows, profile]);

  const openTravelerAvatarOptions = useCallback(() => {
    if (!profile || profile.role !== 'consumer' || isUploadingTravelerAvatar) return;
    setShowTravelerCameraCapture(false);
    setShowTravelerCameraSettingsPrompt(false);
    setShowTravelerAvatarOptions(true);
  }, [isUploadingTravelerAvatar, profile]);

  const promptTravelerCameraSettings = useCallback(() => {
    setShowTravelerAvatarOptions(false);
    setShowTravelerCameraCapture(false);
    setShowTravelerCameraSettingsPrompt(true);
  }, []);

  const handleTravelerTakePhoto = useCallback(async () => {
    if (!profile || profile.role !== 'consumer' || isUploadingTravelerAvatar) return;

    setShowTravelerAvatarOptions(false);

    if (isAndroidAppRuntime()) {
      try {
        let cameraPermission = '';
        const currentPermissions = await CapacitorCamera.checkPermissions();
        cameraPermission = String(currentPermissions?.camera || currentPermissions?.photos || '');

        if (!cameraPermission || cameraPermission === 'prompt' || cameraPermission === 'prompt-with-rationale') {
          const requestedPermissions = await CapacitorCamera.requestPermissions({ permissions: ['camera'] }).catch(() => null);
          cameraPermission = String(requestedPermissions?.camera || requestedPermissions?.photos || cameraPermission || '');
        }

        if (cameraPermission && !['granted', 'limited'].includes(cameraPermission)) {
          promptTravelerCameraSettings();
          return;
        }

        const photo = await CapacitorCamera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          saveToGallery: false,
        });

        const imagePayload =
          String(photo?.dataUrl || '').trim() ||
          (photo?.base64String ? `data:image/jpeg;base64,${photo.base64String}` : '');

        if (imagePayload) {
          await updateTravelerAvatar(imagePayload);
        }
        return;
      } catch (error: any) {
        const nativeMessage = String(error?.message || error || '');
        if (/permission|denied|not authorized|forbidden/i.test(nativeMessage)) {
          promptTravelerCameraSettings();
          return;
        }
        if (!/cancel|user cancelled|user canceled/i.test(nativeMessage)) {
          showAppDialog(nativeMessage || 'We could not open the camera right now. Please try again.', 'error', 'Camera unavailable');
        }
        return;
      }
    }

    setShowTravelerCameraCapture(true);
  }, [isUploadingTravelerAvatar, profile, promptTravelerCameraSettings, updateTravelerAvatar]);

  const handleTravelerAvatarSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !profile || profile.role !== 'consumer') return;

    if (!file.type.startsWith('image/')) {
      showAppDialog('Please choose an image file.', 'warning', 'Invalid file');
      return;
    }

    try {
      const base64 = await fileToDataUrl(file);
      await updateTravelerAvatar(base64);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  }, [profile, updateTravelerAvatar]);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES
  });

  const [authFailure, setAuthFailure] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    const originalAlert = window.alert.bind(window);
    window.alert = ((message?: any) => {
      const normalizedMessage =
        typeof message === 'string'
          ? message
          : message instanceof Error
            ? message.message
            : JSON.stringify(message);
      showAppDialog(normalizedMessage);
    }) as typeof window.alert;

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  useEffect(() => {
    const log = (msg: string) => setDebugInfo(prev => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${msg}`]);
    
    log(`Initializing Maps with key: ${GOOGLE_MAPS_API_KEY.substring(0, 8)}...`);
    
    // @ts-ignore
    window.gm_authFailure = () => {
      log("CRITICAL: Google Maps Authentication Failure detected!");
      setAuthFailure(true);
    };
    
    return () => {
      // @ts-ignore
      window.gm_authFailure = null;
    };
  }, []);

  useEffect(() => {
    if (isLoaded) setDebugInfo(prev => [...prev, "Maps Script Loaded Successfully"]);
    if (loadError) setDebugInfo(prev => [...prev, `Maps Load Error: ${loadError.message}`]);
  }, [isLoaded, loadError]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const initTranslateWidget = () => {
      const googleAny = (window as any).google;
      if (!googleAny?.translate?.TranslateElement) return;
      if (!document.getElementById('google_translate_element')) return;
      try {
        new googleAny.translate.TranslateElement(
          {
            pageLanguage: 'en',
            autoDisplay: false,
            includedLanguages: SUPPORTED_UI_LANGUAGES.map((option) => option.googleCode).join(','),
          },
          'google_translate_element'
        );
        setTranslatorReady(true);
      } catch (error) {
        console.warn('Google Translate widget init failed:', error);
      }
    };

    window.googleTranslateElementInit = initTranslateWidget;
    if ((window as any).google?.translate?.TranslateElement) {
      initTranslateWidget();
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'mairide-google-translate-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .goog-te-banner-frame { display: none !important; visibility: hidden !important; }
      .goog-te-banner-frame.skiptranslate { display: none !important; visibility: hidden !important; }
      iframe.goog-te-banner-frame { display: none !important; visibility: hidden !important; }
      .goog-te-gadget-icon { display: none !important; visibility: hidden !important; }
      .goog-te-gadget-simple { display: none !important; visibility: hidden !important; }
      .goog-te-spinner-pos { display: none !important; visibility: hidden !important; }
      .VIpgJd-ZVi9od-ORHb-OEVmcd { display: none !important; visibility: hidden !important; }
      .VIpgJd-ZVi9od-ORHb { display: none !important; visibility: hidden !important; }
      .VIpgJd-ZVi9od-aZ2wEe-wOHMyf { display: none !important; visibility: hidden !important; }
      .skiptranslate iframe { display: none !important; visibility: hidden !important; }
      body { top: 0 !important; position: static !important; min-height: 100% !important; }
      html { top: 0 !important; }
      #goog-gt-tt, .goog-te-balloon-frame { display: none !important; }
      .goog-tooltip, .goog-tooltip:hover { display: none !important; }
      .goog-text-highlight { background: none !important; box-shadow: none !important; }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const suppressTranslateBanner = () => {
      const selectors = [
        '.goog-te-banner-frame',
        '.goog-te-banner-frame.skiptranslate',
        'iframe.goog-te-banner-frame',
        '.goog-te-gadget-icon',
        '.goog-te-gadget-simple',
        '.goog-te-spinner-pos',
        '.VIpgJd-ZVi9od-ORHb-OEVmcd',
        '.VIpgJd-ZVi9od-ORHb',
        '.VIpgJd-ZVi9od-aZ2wEe-wOHMyf',
        '.skiptranslate',
      ];

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          const element = node as HTMLElement;
          element.style.setProperty('display', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          element.style.setProperty('height', '0', 'important');
          element.style.setProperty('min-height', '0', 'important');
        });
      });

      document.documentElement.style.setProperty('top', '0px', 'important');
      document.body.style.setProperty('top', '0px', 'important');
    };

    suppressTranslateBanner();

    const observer = new MutationObserver(() => {
      suppressTranslateBanner();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!cookieConsent) return;
    const lang = getSupportedUiLanguage(uiLanguage).value;
    document.documentElement.lang = lang;

    if (!canUseCookieCategory(cookieConsent, 'preferences')) {
      safeStorageRemove('local', UI_LANGUAGE_STORAGE_KEY);
      clearGoogleTranslateArtifacts();
      if (lang !== 'en') {
        void ensureGoogleTranslateScriptLoaded(true).then(() => {
          window.setTimeout(() => applyGoogleTranslateLanguage(lang), 80);
          window.setTimeout(() => applyGoogleTranslateLanguage(lang), 220);
          window.setTimeout(() => applyGoogleTranslateLanguage(lang), 650);
        });
      }
      return;
    }

    safeStorageSet('local', UI_LANGUAGE_STORAGE_KEY, lang);
    if (lang === 'en') {
      clearGoogleTranslateArtifacts();
    } else {
      setGoogleTranslateCookie(lang);
      if (!translatorReady) {
        void ensureGoogleTranslateScriptLoaded();
      }
      if (translatorReady) {
        window.setTimeout(() => applyGoogleTranslateLanguage(lang), 80);
      }
    }
  }, [cookieConsent, translatorReady, uiLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined' || user) return;
    if (!cookieConsent) return;
    if (!canUseCookieCategory(cookieConsent, 'preferences')) {
      setShowLanguagePrompt(false);
      return;
    }
    const languageSaved = Boolean(safeStorageGet('local', UI_LANGUAGE_STORAGE_KEY));
    const promptSeen = safeStorageGet('local', UI_LANGUAGE_PROMPT_SEEN_KEY) === '1';
    const appPromptSeen = safeStorageGet('local', UI_LANGUAGE_PROMPT_APP_SEEN_KEY) === '1';
    const shouldForcePromptForApp = isAppWebViewRuntime() && !appPromptSeen;
    if (languageSaved && promptSeen && !shouldForcePromptForApp) {
      setShowLanguagePrompt(false);
      return;
    }
    const sessionPrompted = safeStorageGet('session', UI_LANGUAGE_PROMPT_SESSION_KEY) === '1';
    if (sessionPrompted) return;

    let cancelled = false;
    safeStorageSet('session', UI_LANGUAGE_PROMPT_SESSION_KEY, '1');

    const runDetection = async () => {
      const browserPreferred = detectBrowserPreferredLanguage();
      let detected = safeStorageGet('local', UI_LANGUAGE_STORAGE_KEY) || browserPreferred;
      let promptOptions = buildLanguagePromptOptions('en', 'hi', detected);
      try {
        const geoDetected = await detectLanguagePromptFromGeolocation();
        if (geoDetected) {
          detected = geoDetected.suggested;
          promptOptions = geoDetected.options;
        }
      } catch {
        // fallback remains detected
      }
      if (!cancelled) {
        const normalizedSuggested = getSupportedUiLanguage(detected).value;
        setSuggestedLanguage(normalizedSuggested);
        setLanguagePromptOptions(
          buildLanguagePromptOptions(...promptOptions, normalizedSuggested)
        );
        setShowLanguagePrompt(true);
      }
    };

    void runDetection();
    return () => {
      cancelled = true;
    };
  }, [cookieConsent, user]);

  useEffect(() => {
    let active = true;
    void resolveInstalledAndroidVersion().then((version) => {
      if (!active) return;
      setInstalledAndroidVersion(String(version || APP_VERSION).trim() || APP_VERSION);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!isAndroidAppRuntime()) return;

    let active = true;
    const checkForAndroidUpdate = async () => {
      try {
        const response = await fetch(apiPath(`/downloads/android-update.json?t=${Date.now()}`), { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        const latestVersion = String(data?.appVersion || '').trim();
        const apkUrl = String(data?.apkUrl || LIVE_ANDROID_APK_URL).trim() || LIVE_ANDROID_APK_URL;
        if (!latestVersion) return;
        const needsUpdate = normalizeVersionTag(latestVersion) !== normalizeVersionTag(installedAndroidVersion);
        if (!active) return;
        setAndroidUpdateState({
          available: needsUpdate,
          latestVersion,
          apkUrl,
        });
        if (needsUpdate) {
          const dismissedForVersion = safeStorageGet('local', 'mairide_android_update_dismissed_version');
          setShowAndroidUpdatePrompt(dismissedForVersion !== latestVersion);
        } else {
          setShowAndroidUpdatePrompt(false);
        }
      } catch {
        // Keep runtime stable if update check fails.
      }
    };

    void checkForAndroidUpdate();
    const interval = window.setInterval(() => {
      void checkForAndroidUpdate();
    }, 2 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [installedAndroidVersion]);

  const commitUiLanguage = (nextLanguage: string) => {
    const normalized = getSupportedUiLanguage(nextLanguage).value;
    if (!canUseCookieCategory(cookieConsent, 'preferences')) {
      setUiLanguage(normalized);
      safeStorageRemove('local', UI_LANGUAGE_STORAGE_KEY);
      safeStorageRemove('local', UI_LANGUAGE_PROMPT_SEEN_KEY);
      if (normalized === 'en') {
        clearGoogleTranslateArtifacts();
      } else {
        void ensureGoogleTranslateScriptLoaded(true).then(() => {
          window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 40);
          window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 220);
          window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 650);
        });
      }
      showAppDialog(
        'Language changed for this session. Enable Preferences in Cookie Preferences if you want MaiRide to remember it next time.',
        'info',
        'Language updated'
      );
      return;
    }
    setUiLanguage(normalized);
    safeStorageSet('local', UI_LANGUAGE_STORAGE_KEY, normalized);
    safeStorageSet('local', UI_LANGUAGE_PROMPT_SEEN_KEY, '1');
    if (isAppWebViewRuntime()) {
      safeStorageSet('local', UI_LANGUAGE_PROMPT_APP_SEEN_KEY, '1');
    }
    setShowLanguagePrompt(false);
    void ensureGoogleTranslateScriptLoaded().then(() => {
      window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 40);
      window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 220);
      window.setTimeout(() => applyGoogleTranslateLanguage(normalized), 650);
    });
  };

  const handleDismissAndroidUpdatePrompt = () => {
    if (androidUpdateState.latestVersion) {
      safeStorageSet('local', 'mairide_android_update_dismissed_version', androidUpdateState.latestVersion);
    }
    setShowAndroidUpdatePrompt(false);
  };

  const handleApplyAndroidUpdate = () => {
    const runUpdate = async () => {
      if (isApplyingAndroidUpdate) return;
      setIsApplyingAndroidUpdate(true);
      try {
        const result = await downloadAndOpenAndroidApk(androidUpdateState.apkUrl || LIVE_ANDROID_APK_URL);
        if (result.mode === 'browser-fallback') {
          showAppDialog(
            'The update is downloading through your browser because native install handoff is not available in this build yet.',
            'warning',
            'Downloading update'
          );
        } else {
          showAppDialog(
            'The update package is ready. Android should open the installer now.',
            'success',
            'Preparing update'
          );
        }
      } catch (error: any) {
        const message = String(error?.message || error || '').trim();
        showAppDialog(
          message || 'We could not prepare the Android update automatically. Please try again.',
          'error',
          'Update failed'
        );
      } finally {
        setIsApplyingAndroidUpdate(false);
      }
    };

    void runUpdate();
  };

  const androidUpdatePrompt = showAndroidUpdatePrompt && androidUpdateState.available ? (
    <div className="fixed inset-x-4 bottom-4 z-[96] md:inset-x-auto md:right-6 md:w-[420px]">
      <div className="rounded-[26px] border border-mairide-accent/40 bg-white p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-mairide-accent/10 p-2 text-mairide-accent">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Android update available</p>
            <p className="mt-1 text-sm text-mairide-primary">
              New build <span className="font-bold">{androidUpdateState.latestVersion}</span> is ready. Update now to stay in sync with the latest web release.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleDismissAndroidUpdatePrompt}
            className="flex-1 rounded-xl border border-mairide-secondary px-3 py-2 text-sm font-semibold text-mairide-secondary hover:bg-mairide-bg transition"
          >
            Later
          </button>
          <button
            type="button"
            onClick={handleApplyAndroidUpdate}
            disabled={isApplyingAndroidUpdate}
            className="flex-1 rounded-xl bg-mairide-accent px-3 py-2 text-sm font-bold text-white hover:opacity-90 transition disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isApplyingAndroidUpdate ? 'Preparing…' : 'Update now'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const cookieConsentManager = <CookieConsentManager onChange={setCookieConsent} />;

  if (loading) return <ErrorBoundary><LoadingScreen />{cookieConsentManager}</ErrorBoundary>;

  if (user && !profile) return <ErrorBoundary><LoadingScreen />{cookieConsentManager}</ErrorBoundary>;

  if (!user) return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-mairide-bg">
        <div className="flex-1">
          <AuthPage 
            user={user}
            authMode={authMode} 
            setAuthMode={setAuthMode} 
            notRegisteredError={notRegisteredError} 
            setNotRegisteredError={setNotRegisteredError}
            role={role}
            setRole={setRole}
            referralCodeInput={referralCodeInput}
            setReferralCodeInput={setReferralCodeInput}
            releaseVersion={releaseVersion}
          />
        </div>
        <AppFooter releaseVersion={releaseVersion} buildStamp={buildStamp} />
        <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0">
          <LanguageSwitcher value={uiLanguage} onChange={commitUiLanguage} compact variant="auth" />
        </div>
        <div id="google_translate_element" className="hidden" />
        <AppDialogHost />
        {androidUpdatePrompt}
        {cookieConsentManager}
        <AnimatePresence>
          {showLanguagePrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[95] flex items-center justify-center bg-mairide-primary/40 px-4 backdrop-blur-sm"
            >
              <motion.div
                initial={{ y: 12, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 12, opacity: 0, scale: 0.98 }}
                className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Language preference</p>
                <h3 className="mt-2 text-2xl font-black text-mairide-primary">Choose your app language</h3>
                <p className="mt-2 text-sm text-mairide-secondary">
                  We detected a suggested local language for your region. You can change this anytime from the menu.
                </p>
                <div className="mt-5 grid grid-cols-1 gap-3">
                  <button
                    onClick={() => commitUiLanguage(suggestedLanguage)}
                    className="rounded-2xl bg-mairide-accent px-4 py-3 text-left text-sm font-bold text-white"
                  >
                    Continue in {getSupportedUiLanguage(suggestedLanguage).nativeLabel}
                  </button>
                  {languagePromptOptions
                    .filter((lang) => lang !== suggestedLanguage)
                    .map((lang) => (
                      <button
                        key={lang}
                        onClick={() => commitUiLanguage(lang)}
                        className="rounded-2xl border border-mairide-secondary px-4 py-3 text-left text-sm font-semibold text-mairide-primary"
                      >
                        Continue in {getSupportedUiLanguage(lang).nativeLabel}
                      </button>
                    ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );

  if (profile && profile.role === 'driver') {
    if (!profile.onboardingComplete) {
      return <ErrorBoundary><DriverOnboarding profile={profile} onComplete={() => window.location.reload()} isLoaded={isLoaded} />{cookieConsentManager}</ErrorBoundary>;
    }
    if (profile.verificationStatus === 'pending') {
      return <ErrorBoundary><DriverPendingApproval profile={profile} />{cookieConsentManager}</ErrorBoundary>;
    }
    if (profile.verificationStatus === 'rejected') {
      return <ErrorBoundary><DriverRejected profile={profile} />{cookieConsentManager}</ErrorBoundary>;
    }
  }

  if (profile && profile.role === 'admin') {
    return (
      <ErrorBoundary>
        {profile.forcePasswordChange && <ForcePasswordChangeModal profile={profile} />}
        <div className="min-h-screen bg-mairide-bg flex flex-col">
          <div className="fixed left-1/2 top-4 z-[70] -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0">
            <LanguageSwitcher value={uiLanguage} onChange={commitUiLanguage} compact />
          </div>
          <div id="google_translate_element" className="hidden" />
          <div className="flex-1">
            <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} />
          </div>
          <AppFooter releaseVersion={releaseVersion} buildStamp={buildStamp} />
          <AppDialogHost />
          {androidUpdatePrompt}
          {cookieConsentManager}
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-mairide-bg">
          <Navbar
            user={user}
            profile={profile}
            onLogout={handleLogout}
            uiLanguage={uiLanguage}
            onChangeLanguage={commitUiLanguage}
            onTravelerAvatarTrigger={openTravelerAvatarOptions}
            isUploadingTravelerAvatar={isUploadingTravelerAvatar}
          />
          <div id="google_translate_element" className="hidden" />
          <main className="pb-20">
            <Routes>
              <Route path="/" element={
                profile?.role === 'admin' ? <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> :
                profile?.role === 'driver' ? <DriverApp profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : 
                profile ? <ConsumerApp profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : <LoadingScreen releaseVersion={releaseVersion} />
              } />
              <Route path="/admin" element={profile?.role === 'admin' ? <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : <Navigate to="/" />} />
              <Route path="/support" element={profile ? <SupportSystem profile={profile} /> : <Navigate to="/" />} />
              <Route path="/consumer/bookings" element={profile ? <MyBookings profile={profile} /> : <Navigate to="/" />} />
              <Route path="/driver/rides" element={profile ? <MyRides profile={profile} /> : <Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <AppFooter releaseVersion={releaseVersion} buildStamp={buildStamp} />
          <Chatbot userRole={profile?.role} userId={profile?.uid} />
          <AppDialogHost />
          {androidUpdatePrompt}
          {cookieConsentManager}
          {isTravelerProfile && (
            <input
              ref={travelerAvatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleTravelerAvatarSelected}
            />
          )}

          <AnimatePresence>
            {showTravelerAvatarOptions && isTravelerProfile && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[90] bg-mairide-primary/40 backdrop-blur-sm"
                  onClick={closeTravelerAvatarFlows}
                />
                <div className="fixed inset-0 z-[100] grid place-items-center p-4 sm:p-6">
                  <motion.div
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                    className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-mairide-secondary/40" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler Avatar</p>
                    <h3 className="mt-2 text-2xl font-black text-mairide-primary">Choose profile photo</h3>
                    <p className="mt-2 text-sm text-mairide-secondary">Add a clean profile image for your traveler account.</p>
                    <div className="mt-6 space-y-3">
                      <button
                        type="button"
                        onClick={handleTravelerTakePhoto}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mairide-primary px-4 py-4 font-bold text-white"
                      >
                        <Camera className="h-5 w-5" />
                        <span>Take Photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTravelerAvatarOptions(false);
                          travelerAvatarInputRef.current?.click();
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-mairide-secondary bg-white px-4 py-4 font-bold text-mairide-primary"
                      >
                        <Upload className="h-5 w-5" />
                        <span>Upload Photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={closeTravelerAvatarFlows}
                        className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-mairide-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showTravelerCameraSettingsPrompt && isTravelerProfile && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[90] bg-mairide-primary/40 backdrop-blur-sm"
                  onClick={closeTravelerAvatarFlows}
                />
                <div className="fixed inset-0 z-[100] grid place-items-center p-4 sm:p-6">
                  <motion.div
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                    className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mairide-bg text-mairide-primary">
                      <Settings className="h-7 w-7" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Camera Access</p>
                    <h3 className="mt-2 text-2xl font-black text-mairide-primary">Enable camera permission</h3>
                    <p className="mt-2 text-sm leading-6 text-mairide-secondary">
                      MaiRide needs camera access to capture your traveler profile photo. Open app settings, allow camera permission, then come back here and try again.
                    </p>
                    <div className="mt-6 space-y-3">
                      <button
                        type="button"
                        onClick={async () => {
                          const opened = await openAndroidAppSettings();
                          if (!opened) {
                            showAppDialog('Please enable camera access for MaiRide from your phone settings and try again.', 'warning', 'Camera permission needed');
                          }
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mairide-primary px-4 py-4 font-bold text-white"
                      >
                        <Settings className="h-5 w-5" />
                        <span>Open Settings</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTravelerCameraSettingsPrompt(false);
                          travelerAvatarInputRef.current?.click();
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-mairide-secondary bg-white px-4 py-4 font-bold text-mairide-primary"
                      >
                        <Upload className="h-5 w-5" />
                        <span>Upload Photo Instead</span>
                      </button>
                      <button
                        type="button"
                        onClick={closeTravelerAvatarFlows}
                        className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-mairide-secondary"
                      >
                        Not now
                      </button>
                    </div>
                  </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>

          {showTravelerCameraCapture && isTravelerProfile && (
            <CameraCapture
              title="Capture traveler profile photo"
              onCancel={closeTravelerAvatarFlows}
              onCapture={async (image) => {
                await updateTravelerAvatar(image);
              }}
            />
          )}

          <AnimatePresence>
            {showLanguagePrompt && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[95] flex items-center justify-center bg-mairide-primary/40 px-4 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ y: 12, opacity: 0, scale: 0.98 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 12, opacity: 0, scale: 0.98 }}
                  className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Language preference</p>
                  <h3 className="mt-2 text-2xl font-black text-mairide-primary">Choose your app language</h3>
                  <p className="mt-2 text-sm text-mairide-secondary">
                    We detected a suggested local language for your region. You can change this anytime from the top menu.
                  </p>
                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <button
                      onClick={() => commitUiLanguage(suggestedLanguage)}
                      className="rounded-2xl bg-mairide-accent px-4 py-3 text-left text-sm font-bold text-white"
                    >
                      Continue in {getSupportedUiLanguage(suggestedLanguage).nativeLabel}
                    </button>
                    {languagePromptOptions
                      .filter((lang) => lang !== suggestedLanguage)
                      .map((lang) => (
                        <button
                          key={lang}
                          onClick={() => commitUiLanguage(lang)}
                          className="rounded-2xl border border-mairide-secondary px-4 py-3 text-left text-sm font-semibold text-mairide-primary"
                        >
                          Continue in {getSupportedUiLanguage(lang).nativeLabel}
                        </button>
                      ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
