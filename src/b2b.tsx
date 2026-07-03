import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowUpRight,
  Building2,
  Car,
  CheckCircle2,
  Clock3,
  Trash2,
  Eye,
  FileBadge2,
  Globe2,
  Hotel,
  IndianRupee,
  Loader2,
  MapPin,
  Save,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { cn, formatCurrency } from './lib/utils';
import { b2bPartnerService } from './services/b2bPartnerService';
import type { ApprovalStatus, B2BPartner, PartnerBooking, PartnerType, PartnerVehicle, Ride, Booking, UserProfile } from './types';

const partnerTypeMeta: Record<PartnerType, { label: string; eyebrow: string; icon: typeof Hotel; copy: string }> = {
  fleet_owner: {
    label: 'Fleet Owner & Travel Agent',
    eyebrow: 'Fleet access',
    icon: Car,
    copy: 'Manage multiple vehicles, dispatch faster, and shape driver compensation in one isolated workspace.',
  },
  hotel_partner: {
    label: 'Hotel & Resort Partner',
    eyebrow: 'Hotel partner access',
    icon: Hotel,
    copy: 'Book rides for guests from a clean desk console while tracking commission and service quality in real time.',
  },
};

const payoutModelOptions = [
  { value: 'flat_salary', label: 'Flat salary' },
  { value: 'per_ride_cut', label: 'Per-ride cut' },
  { value: 'fixed_percentage', label: 'Fixed percentage' },
] as const;

const normalizeSearchText = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenizeSearchText = (value: string) =>
  normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

const captureSignupLocation = () =>
  new Promise<{ latitude: number | null; longitude: number | null }>((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: null, longitude: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve({ latitude: null, longitude: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });

const getOptionalPartnerAccessToken = async () => {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    return session?.access_token || '';
  } catch {
    return '';
  }
};

const submitPartnerApplication = async ({
  partnerType,
  formData,
  documentFile,
  signupLatitude,
  signupLongitude,
}: {
  partnerType: PartnerType;
  formData: {
    businessName: string;
    contactPerson: string;
    phone: string;
    email: string;
    gstNumber: string;
  };
  documentFile: File;
  signupLatitude: number | null;
  signupLongitude: number | null;
}) => {
  const accessToken = await getOptionalPartnerAccessToken();
  const documentDataUrl = await readFileAsDataUrl(documentFile);
  const response = await fetch('/api/admin-api?action=partner-submit-application', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      partnerType,
      businessName: formData.businessName.trim(),
      contactPerson: formData.contactPerson.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim().toLowerCase(),
      gstNumber: formData.gstNumber.trim(),
      signupLatitude,
      signupLongitude,
      documentName: documentFile.name,
      documentDataUrl,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || 'We could not submit your partner application right now.'));
  }
  return payload?.partner as B2BPartner;
};

const getAdminRequestHeaders = async () => {
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || '';
  if (!token) {
    throw new Error('Admin session unavailable. Please sign in again.');
  }
  return {
    Authorization: `Bearer ${token}`,
  };
};

const PartnerStat = ({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) => (
  <div className="rounded-[28px] border border-mairide-secondary bg-white p-5 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{label}</p>
    <p className="mt-3 text-3xl font-black tracking-tight text-mairide-primary">{value}</p>
    {detail ? <p className="mt-2 text-sm text-mairide-secondary">{detail}</p> : null}
  </div>
);

const PartnerHeader = ({
  partner,
  title,
  subtitle,
}: {
  partner: B2BPartner;
  title: string;
  subtitle: string;
}) => {
  const meta = partnerTypeMeta[partner.type];
  const Icon = meta.icon;
  return (
    <div className="rounded-[36px] border border-mairide-secondary bg-white p-7 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-[26px] bg-mairide-bg p-4 text-mairide-accent">
            <Icon className="h-8 w-8" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">{meta.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-mairide-primary">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-mairide-secondary">{subtitle}</p>
          </div>
        </div>
        <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg px-5 py-4 text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Current status</p>
          <p className="mt-2 text-lg font-black capitalize text-mairide-primary">{partner.status}</p>
          <p className="mt-1 text-xs text-mairide-secondary">{partner.businessName}</p>
        </div>
      </div>
    </div>
  );
};

export const PartnerApplicationPage = ({
  partnerType,
  currentUser,
}: {
  partnerType: PartnerType;
  currentUser: User | null;
}) => {
  const meta = partnerTypeMeta[partnerType];
  const Icon = meta.icon;
  const [formData, setFormData] = useState({
    businessName: '',
    contactPerson: currentUser?.displayName || '',
    phone: '',
    email: currentUser?.email || '',
    gstNumber: '',
  });
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successPartner, setSuccessPartner] = useState<B2BPartner | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentFile) {
      setErrorMessage('Please upload a verification document before submitting.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const { latitude, longitude } = await captureSignupLocation();
      const createdPartner = await submitPartnerApplication({
        partnerType,
        formData,
        documentFile,
        signupLatitude: latitude,
        signupLongitude: longitude,
      });
      setSuccessPartner(createdPartner);
    } catch (error: any) {
      setErrorMessage(String(error?.message || 'We could not submit your partner application right now.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successPartner) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <div className="rounded-[40px] border border-mairide-secondary bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-[24px] bg-green-50 p-4 text-green-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Application received</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-mairide-primary">
                Thanks, we have your {meta.label.toLowerCase()} request.
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-mairide-secondary">
                The verification desk can now review your business profile, uploaded document, and signup location. Once approved, this same account can open the partner workspace.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] bg-mairide-bg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Business</p>
                  <p className="mt-2 text-lg font-bold text-mairide-primary">{successPartner.businessName}</p>
                </div>
                <div className="rounded-[24px] bg-mairide-bg p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Current status</p>
                  <p className="mt-2 text-lg font-bold capitalize text-mairide-primary">{successPartner.status}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[40px] border border-mairide-secondary bg-white p-8 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="rounded-[24px] bg-mairide-bg p-4 text-mairide-accent">
              <Icon className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">{meta.eyebrow}</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-mairide-primary">{meta.label}</h1>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-sm text-mairide-secondary">{meta.copy}</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Business name</span>
                <input
                  className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  value={formData.businessName}
                  onChange={(event) => setFormData((current) => ({ ...current, businessName: event.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Contact person</span>
                <input
                  className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  value={formData.contactPerson}
                  onChange={(event) => setFormData((current) => ({ ...current, contactPerson: event.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Phone</span>
                <input
                  className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  value={formData.phone}
                  onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Email</span>
                <input
                  type="email"
                  className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  value={formData.email}
                  onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">GSTIN (optional)</span>
                <input
                  className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                  value={formData.gstNumber}
                  onChange={(event) => setFormData((current) => ({ ...current, gstNumber: event.target.value }))}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Verification document</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
                  className="w-full rounded-2xl border border-dashed border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none"
                  required
                />
                <p className="mt-2 text-xs text-mairide-secondary">Upload RC, trade license, or hotel ownership proof. The system will also capture your device location at submission.</p>
              </label>
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-2xl bg-mairide-primary px-6 py-4 text-sm font-bold text-white transition-colors hover:bg-mairide-accent disabled:opacity-60"
            >
              {isSubmitting ? 'Submitting application...' : `Submit ${meta.label} Request`}
            </button>
          </form>
        </div>

        <aside className="space-y-5">
          <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Verification flow</p>
            <div className="mt-4 space-y-4">
              {[
                { icon: FileBadge2, title: 'Document review', copy: 'MaiRide verifies uploaded ownership or operating proof before any dashboard access is opened.' },
                { icon: MapPin, title: 'Geo-tag capture', copy: 'Signup location is stored with the application to support audit-grade partner verification.' },
                { icon: ShieldCheck, title: 'Manual admin approval', copy: 'The main admin panel gets a dedicated verification desk for every pending partner request.' },
              ].map((item) => (
                <div key={item.title} className="rounded-[24px] bg-mairide-bg p-4">
                  <item.icon className="h-5 w-5 text-mairide-accent" />
                  <p className="mt-3 text-sm font-bold text-mairide-primary">{item.title}</p>
                  <p className="mt-1 text-sm text-mairide-secondary">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
};

const PartnerStatusPanel = ({ partner }: { partner: B2BPartner }) => {
  const isApproved = partner.status === 'approved';
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PartnerHeader
        partner={partner}
        title={partner.businessName}
        subtitle={
          isApproved
            ? 'Your partner account is approved and ready.'
            : partner.status === 'rejected'
              ? 'This partner application was rejected. Please connect with the MaiRide admin team before reapplying.'
              : 'Your partner application is in review. The verification desk can approve it from the main admin panel as soon as the checks are complete.'
        }
      />
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <PartnerStat label="Partner type" value={partnerTypeMeta[partner.type].label} />
        <PartnerStat label="Contact person" value={partner.contactPerson} />
        <PartnerStat label="Registered email" value={partner.email} />
      </div>
    </div>
  );
};

const computeHotelMarkupRate = (partner: B2BPartner) =>
  Number(partner.data?.hotelMarkupPercentage ?? partner.commissionPercentage ?? 0);

const HotelPartnerDashboard = ({
  partner,
  bookings,
  rides,
  onPartnerUpdated,
  onBookingCreated,
}: {
  partner: B2BPartner;
  bookings: PartnerBooking[];
  rides: Ride[];
  onPartnerUpdated: (partner: B2BPartner) => void;
  onBookingCreated: (booking: PartnerBooking) => void;
}) => {
  const activeRides = bookings.filter((booking) => booking.settlementStatus === 'pending').length;
  const totalGross = bookings.reduce((sum, booking) => sum + booking.totalFare, 0);
  const totalCommission = bookings.reduce((sum, booking) => sum + booking.partnerCut, 0);
  const activeMarkupRate = computeHotelMarkupRate(partner);
  const [markupPercentage, setMarkupPercentage] = useState(String(activeMarkupRate || 0));
  const [deskForm, setDeskForm] = useState({
    guestName: '',
    guestPhone: '',
    pickup: '',
    dropoff: '',
    pickupTime: '',
    rideId: '',
    notes: '',
  });
  const [isSavingCommission, setIsSavingCommission] = useState(false);
  const [isCreatingDeskBooking, setIsCreatingDeskBooking] = useState(false);
  const [deskNotice, setDeskNotice] = useState<string | null>(null);
  const [routeQuery, setRouteQuery] = useState({
    pickup: '',
    dropoff: '',
  });

  useEffect(() => {
    setMarkupPercentage(String(activeMarkupRate || 0));
  }, [activeMarkupRate]);

  const routeMatchedRides = useMemo(() => {
    const pickupTokens = tokenizeSearchText(routeQuery.pickup || deskForm.pickup);
    const dropoffTokens = tokenizeSearchText(routeQuery.dropoff || deskForm.dropoff);
    if (!pickupTokens.length && !dropoffTokens.length) {
      return rides.slice(0, 12);
    }

    return rides.filter((ride) => {
      const haystack = normalizeSearchText([ride.origin, ride.destination, ride.driverName, ride.fleetPartnerName].filter(Boolean).join(' '));
      const pickupMatch = !pickupTokens.length || pickupTokens.every((token) => haystack.includes(token));
      const dropoffMatch = !dropoffTokens.length || dropoffTokens.every((token) => haystack.includes(token));
      return pickupMatch && dropoffMatch;
    });
  }, [deskForm.dropoff, deskForm.pickup, rides, routeQuery.dropoff, routeQuery.pickup]);

  const selectedRide = useMemo(
    () => routeMatchedRides.find((ride) => ride.id === deskForm.rideId) || rides.find((ride) => ride.id === deskForm.rideId) || null,
    [deskForm.rideId, rides, routeMatchedRides]
  );

  const bookingPreview = useMemo(() => {
    if (!selectedRide) return null;
    const commissionPercentage = Number(markupPercentage || activeMarkupRate || 0);
    const baseFare = Number(selectedRide.price || 0);
    const commissionAmount = Number(((baseFare * commissionPercentage) / 100).toFixed(2));
    const travelerCharge = Number((baseFare + commissionAmount).toFixed(2));
    return {
      commissionPercentage,
      baseFare,
      commissionAmount,
      travelerCharge,
      driverPayout: baseFare,
    };
  }, [activeMarkupRate, markupPercentage, selectedRide]);

  const saveHotelMarkup = async () => {
    setIsSavingCommission(true);
    try {
      const updated = await b2bPartnerService.updatePartnerProfile(partner.id, {
        data: {
          ...(partner.data || {}),
          hotelMarkupPercentage: Number(markupPercentage || 0),
        },
      });
      onPartnerUpdated(updated);
      setDeskNotice('Hotel traveler markup saved. New guest bookings will charge this markup on top of the driver base fare.');
    } finally {
      setIsSavingCommission(false);
    }
  };

  const createDeskBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsCreatingDeskBooking(true);
    setDeskNotice(null);
    try {
      if (!selectedRide || !bookingPreview) {
        throw new Error('Please select a matched network ride before creating a guest booking.');
      }
      const createdBooking = await b2bPartnerService.createHotelDeskBooking({
        partnerId: partner.id,
        rideId: selectedRide.id,
        guestName: deskForm.guestName,
        guestPhone: deskForm.guestPhone,
        pickup: deskForm.pickup || selectedRide.origin,
        dropoff: deskForm.dropoff || selectedRide.destination,
        pickupTime: deskForm.pickupTime,
        commissionPercentage: bookingPreview.commissionPercentage,
        notes: deskForm.notes,
      });
      onBookingCreated(createdBooking);
      setDeskForm({
        guestName: '',
        guestPhone: '',
        pickup: '',
        dropoff: '',
        pickupTime: '',
        rideId: '',
        notes: '',
      });
      setRouteQuery({ pickup: '', dropoff: '' });
      setDeskNotice('Guest booking created. Traveler charge uses the hotel markup, driver payout stays protected, and settlement is locked to MaiRide Secure Pay.');
    } catch (error: any) {
      setDeskNotice(String(error?.message || 'We could not create the desk booking right now.'));
    } finally {
      setIsCreatingDeskBooking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PartnerHeader
        partner={partner}
        title="Hotel & Resort Dashboard"
        subtitle="Run guest ride dispatch from the front desk, track live booking load, and keep commission visibility clean for your property team."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <PartnerStat label="Guest bookings" value={bookings.length} detail="All desk-dispatched rides linked to this partner" />
        <PartnerStat label="Active rides" value={activeRides} detail="Bookings waiting for settlement or ride closure" />
        <PartnerStat label="Accrued commission" value={formatCurrency(totalCommission)} detail={`Gross processed: ${formatCurrency(totalGross)}`} />
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Traveler markup control</p>
              <h2 className="mt-2 text-xl font-bold text-mairide-primary">Hotel commission on top of base fare</h2>
            </div>
            <div className="rounded-[22px] bg-mairide-bg px-4 py-3 text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Current traveler markup</p>
              <p className="mt-1 text-2xl font-black text-mairide-primary">{activeMarkupRate.toFixed(2)}%</p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Hotel markup percentage</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={markupPercentage}
                onChange={(event) => setMarkupPercentage(event.target.value)}
                className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
              />
            </label>
            <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg p-4">
              <p className="text-sm font-bold text-mairide-primary">Commercial rule</p>
              <p className="mt-2 text-sm text-mairide-secondary">
                This markup is added to the traveler-facing total. The listed driver or fleet fare stays intact, so the partner revenue never reduces driver payout.
              </p>
            </div>
            <button
              type="button"
              onClick={saveHotelMarkup}
              disabled={isSavingCommission}
              className="rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-mairide-accent disabled:opacity-60"
            >
              {isSavingCommission ? 'Saving markup...' : 'Save traveler markup'}
            </button>
          </div>
        </div>

        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Desk console</p>
          <h2 className="mt-2 text-xl font-bold text-mairide-primary">Book a ride for a guest</h2>
          <p className="mt-2 text-sm text-mairide-secondary">Search across the live MaiRide network, including mapped fleet inventory, then create a guest booking that is settled only through MaiRide Secure Pay.</p>
          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={createDeskBooking}>
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Guest name" value={deskForm.guestName} onChange={(event) => setDeskForm((current) => ({ ...current, guestName: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Guest phone" value={deskForm.guestPhone} onChange={(event) => setDeskForm((current) => ({ ...current, guestPhone: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Pickup" value={deskForm.pickup} onChange={(event) => { const value = event.target.value; setDeskForm((current) => ({ ...current, pickup: value })); setRouteQuery((current) => ({ ...current, pickup: value })); }} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Dropoff" value={deskForm.dropoff} onChange={(event) => { const value = event.target.value; setDeskForm((current) => ({ ...current, dropoff: value })); setRouteQuery((current) => ({ ...current, dropoff: value })); }} required />
            <input type="datetime-local" className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={deskForm.pickupTime} onChange={(event) => setDeskForm((current) => ({ ...current, pickupTime: event.target.value }))} />
            <select className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={deskForm.rideId} onChange={(event) => setDeskForm((current) => ({ ...current, rideId: event.target.value }))}>
              <option value="">Select a matched live ride</option>
              {routeMatchedRides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {ride.origin} → {ride.destination} ({formatCurrency(ride.price)}){ride.fleetPartnerName ? ` • ${ride.fleetPartnerName}` : ''}
                </option>
              ))}
            </select>
            <textarea className="min-h-[110px] rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Guest notes or concierge instructions (optional)" value={deskForm.notes} onChange={(event) => setDeskForm((current) => ({ ...current, notes: event.target.value }))} />
            <div className="rounded-[24px] border border-mairide-accent/25 bg-mairide-accent/5 p-4 md:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-accent">Payment policy</p>
              <p className="mt-2 text-sm font-medium text-mairide-primary">
                All B2B bookings are collected only through <span className="font-black">MaiRide Secure Pay (Razorpay)</span>. No off-platform or cash collection is allowed in this channel.
              </p>
            </div>
            {selectedRide && bookingPreview ? (
              <div className="grid gap-3 rounded-[24px] border border-mairide-secondary bg-mairide-bg p-4 md:col-span-2 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Selected network ride</p>
                  <p className="mt-2 text-sm font-bold text-mairide-primary">{selectedRide.origin} → {selectedRide.destination}</p>
                  <p className="mt-1 text-sm text-mairide-secondary">
                    Driver: {selectedRide.driverName || 'Assigned driver'}
                    {selectedRide.fleetPartnerName ? ` • Fleet: ${selectedRide.fleetPartnerName}` : ''}
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-mairide-secondary">Driver / fleet base fare</span><span className="font-bold text-mairide-primary">{formatCurrency(bookingPreview.baseFare)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-mairide-secondary">Hotel markup ({bookingPreview.commissionPercentage.toFixed(2)}%)</span><span className="font-bold text-mairide-accent">{formatCurrency(bookingPreview.commissionAmount)}</span></div>
                  <div className="flex items-center justify-between border-t border-mairide-secondary/25 pt-2"><span className="font-bold text-mairide-primary">Traveler charge</span><span className="text-lg font-black text-mairide-primary">{formatCurrency(bookingPreview.travelerCharge)}</span></div>
                </div>
              </div>
            ) : null}
            {deskNotice ? <div className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-3 text-sm text-mairide-primary md:col-span-2">{deskNotice}</div> : null}
            <button type="submit" disabled={isCreatingDeskBooking} className="rounded-2xl bg-mairide-primary px-5 py-4 text-sm font-bold text-white transition-colors hover:bg-mairide-accent disabled:opacity-60 md:col-span-2">
              {isCreatingDeskBooking ? 'Creating secure booking...' : 'Create secure guest booking'}
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Recent partner ledger</p>
            <h2 className="mt-2 text-xl font-bold text-mairide-primary">Latest guest ride entries</h2>
          </div>
          <span className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
            {bookings.length} entries
          </span>
        </div>
        <div className="mt-5 divide-y divide-mairide-secondary/25 rounded-[24px] border border-mairide-secondary overflow-hidden">
          {bookings.length ? bookings.slice(0, 6).map((booking) => (
            <div key={booking.id} className="grid gap-4 px-5 py-4 md:grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr]">
              <div>
                <p className="font-bold text-mairide-primary">{booking.data?.rideLabel || `${booking.data?.pickup || 'Pickup'} → ${booking.data?.dropoff || 'Dropoff'}`}</p>
                <p className="mt-1 text-sm text-mairide-secondary">{booking.data?.guestName || 'Guest'} • {booking.data?.guestPhone || 'Phone not logged'}</p>
              </div>
              <div className="text-sm font-bold text-mairide-primary">{formatCurrency(booking.totalFare)}</div>
              <div className="text-sm font-bold text-mairide-accent">{formatCurrency(booking.partnerCut)}</div>
              <div>
                <span className="inline-flex rounded-full bg-mairide-bg px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mairide-primary">
                  {booking.settlementStatus}
                </span>
              </div>
            </div>
          )) : (
            <div className="px-5 py-10 text-sm text-mairide-secondary">No guest desk rides logged yet.</div>
          )}
        </div>
      </section>
    </div>
  );
};

const FleetPartnerDashboard = ({
  partner,
  bookings,
  fleetDrivers,
  fleetRides,
  fleetBookings,
  onPartnerUpdated,
}: {
  partner: B2BPartner;
  bookings: PartnerBooking[];
  fleetDrivers: UserProfile[];
  fleetRides: Ride[];
  fleetBookings: Booking[];
  onPartnerUpdated: (partner: B2BPartner) => void;
}) => {
  const fleetVehicles = partner.data?.fleetVehicles || [];
  const liveLogs = partner.data?.liveLogs || [];
  const payoutModel = partner.data?.payoutModel || { model: 'per_ride_cut', value: 0, description: '' };
  const totalGross = bookings.reduce((sum, booking) => sum + booking.totalFare, 0);
  const activeVehicles = fleetVehicles.filter((vehicle) => vehicle.status === 'active').length;
  const totalPendingCash = fleetDrivers.reduce((sum, driver) => sum + Number(driver.cashWallet?.pendingBalance || 0), 0);
  const totalAvailableCash = fleetDrivers.reduce((sum, driver) => sum + Number(driver.cashWallet?.availableBalance || 0), 0);
  const [vehicleDraft, setVehicleDraft] = useState<PartnerVehicle>({
    id: '',
    label: '',
    registrationNumber: '',
    assignedDriverName: '',
    assignedDriverId: '',
    assignedDriverPhone: '',
    assignedDriverEmail: '',
    status: 'active',
    liveLog: '',
  });
  const [payoutDraft, setPayoutDraft] = useState({
    model: payoutModel.model,
    value: String(payoutModel.value || 0),
    description: payoutModel.description || '',
  });
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const updatePartnerData = async (nextData: B2BPartner['data']) => {
    const updated = await b2bPartnerService.updatePartnerProfile(partner.id, {
      data: nextData,
    });
    onPartnerUpdated(updated);
  };

  const addVehicle = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextVehicles = [
      ...fleetVehicles,
      {
        ...vehicleDraft,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      },
    ];
    await updatePartnerData({
      ...(partner.data || {}),
      fleetVehicles: nextVehicles,
      liveLogs: [
        {
          id: crypto.randomUUID(),
          vehicleId: nextVehicles[nextVehicles.length - 1].id,
          title: 'Vehicle onboarded',
          detail: `${vehicleDraft.label} has been added to the fleet console.`,
          createdAt: new Date().toISOString(),
        },
        ...liveLogs,
      ].slice(0, 20),
    });
      setVehicleDraft({
        id: '',
        label: '',
        registrationNumber: '',
        assignedDriverName: '',
        assignedDriverId: '',
        assignedDriverPhone: '',
        assignedDriverEmail: '',
        status: 'active',
        liveLog: '',
      });
    setSaveMessage('Fleet vehicle added.');
  };

  const savePayoutModel = async () => {
    await updatePartnerData({
      ...(partner.data || {}),
      payoutModel: {
        model: payoutDraft.model,
        value: Number(payoutDraft.value || 0),
        description: payoutDraft.description,
        updatedAt: new Date().toISOString(),
      },
    });
    setSaveMessage('Driver payout rules updated.');
  };

  return (
    <div className="space-y-6">
      <PartnerHeader
        partner={partner}
        title="Fleet Operations Dashboard"
        subtitle="See active fleet capacity, keep a clean ledger of gross fares, and configure driver compensation without touching the traveler application logic."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <PartnerStat label="Vehicles in console" value={fleetVehicles.length} detail={`${activeVehicles} currently marked active`} />
        <PartnerStat label="Fleet gross fares" value={formatCurrency(totalGross || fleetBookings.reduce((sum, booking) => sum + Number(booking.totalPrice || booking.fare || 0), 0))} detail={`${fleetRides.filter((ride) => ['available', 'negotiating', 'started', 'in_progress'].includes(String(ride.status))).length} live listed rides`} />
        <PartnerStat label="Driver cash wallet" value={formatCurrency(totalPendingCash)} detail={`Available INR: ${formatCurrency(totalAvailableCash)}`} />
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Fleet management</p>
              <h2 className="mt-2 text-xl font-bold text-mairide-primary">Multi-car management table</h2>
            </div>
            <span className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
              {fleetVehicles.length} vehicles
            </span>
          </div>
          <div className="mt-6 overflow-hidden rounded-[24px] border border-mairide-secondary">
            <div className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-4 bg-mairide-bg px-4 py-3 text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">
              <span>Vehicle</span>
              <span>Assigned driver</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-mairide-secondary/30">
              {fleetVehicles.length ? fleetVehicles.map((vehicle) => (
                <div key={vehicle.id} className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-4 px-4 py-4 text-sm">
                  <div>
                    <p className="font-bold text-mairide-primary">{vehicle.label}</p>
                    <p className="text-mairide-secondary">{vehicle.registrationNumber}</p>
                    {vehicle.liveLog ? <p className="mt-2 text-xs text-mairide-secondary">{vehicle.liveLog}</p> : null}
                  </div>
                    <div className="font-medium text-mairide-primary">
                      <p>{vehicle.assignedDriverName || 'Unassigned'}</p>
                      {vehicle.assignedDriverPhone ? <p className="mt-1 text-xs text-mairide-secondary">{vehicle.assignedDriverPhone}</p> : null}
                      {vehicle.assignedDriverId ? <p className="mt-1 text-[11px] font-mono text-mairide-secondary">{vehicle.assignedDriverId}</p> : null}
                    </div>
                  <div>
                    <span className={cn(
                      'inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                      vehicle.status === 'active'
                        ? 'bg-green-50 text-green-700'
                        : vehicle.status === 'maintenance'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-mairide-bg text-mairide-primary'
                    )}>
                      {vehicle.status}
                    </span>
                  </div>
                </div>
              )) : (
                <div className="px-4 py-10 text-center text-sm text-mairide-secondary">
                  No fleet vehicles added yet.
                </div>
              )}
            </div>
          </div>

          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={addVehicle}>
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Vehicle label" value={vehicleDraft.label} onChange={(event) => setVehicleDraft((current) => ({ ...current, label: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Registration number" value={vehicleDraft.registrationNumber} onChange={(event) => setVehicleDraft((current) => ({ ...current, registrationNumber: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Assigned driver name" value={vehicleDraft.assignedDriverName} onChange={(event) => setVehicleDraft((current) => ({ ...current, assignedDriverName: event.target.value }))} />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Assigned driver UID" value={vehicleDraft.assignedDriverId || ''} onChange={(event) => setVehicleDraft((current) => ({ ...current, assignedDriverId: event.target.value }))} />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Assigned driver phone" value={vehicleDraft.assignedDriverPhone || ''} onChange={(event) => setVehicleDraft((current) => ({ ...current, assignedDriverPhone: event.target.value }))} />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Assigned driver email" value={vehicleDraft.assignedDriverEmail || ''} onChange={(event) => setVehicleDraft((current) => ({ ...current, assignedDriverEmail: event.target.value }))} />
            <select className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={vehicleDraft.status} onChange={(event) => setVehicleDraft((current) => ({ ...current, status: event.target.value as PartnerVehicle['status'] }))}>
              <option value="active">Active</option>
              <option value="idle">Idle</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <textarea className="min-h-[110px] rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Latest live log or dispatch note" value={vehicleDraft.liveLog} onChange={(event) => setVehicleDraft((current) => ({ ...current, liveLog: event.target.value }))} />
            <button className="rounded-2xl bg-mairide-primary px-5 py-4 text-sm font-bold text-white transition-colors hover:bg-mairide-accent md:col-span-2">
              Add vehicle
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Payout controls</p>
            <h2 className="mt-2 text-xl font-bold text-mairide-primary">Driver compensation model</h2>
            <p className="mt-2 text-sm text-mairide-secondary">This configuration lives only inside the partner workspace and does not interfere with traveler pricing or Razorpay collection logic.</p>
            <div className="mt-5 space-y-4">
              <select className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={payoutDraft.model} onChange={(event) => setPayoutDraft((current) => ({ ...current, model: event.target.value as typeof payoutDraft.model }))}>
                {payoutModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input type="number" min="0" className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={payoutDraft.value} onChange={(event) => setPayoutDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Value" />
              <textarea className="min-h-[120px] w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={payoutDraft.description} onChange={(event) => setPayoutDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Describe how drivers are paid in this fleet." />
              <button type="button" onClick={savePayoutModel} className="rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-mairide-accent">
                Save payout model
              </button>
            </div>
          </div>

          <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Live logs</p>
            <h2 className="mt-2 text-xl font-bold text-mairide-primary">Dispatch activity</h2>
            <div className="mt-5 space-y-3">
              {liveLogs.length ? liveLogs.slice(0, 6).map((log) => (
                <div key={log.id} className="rounded-[22px] bg-mairide-bg p-4">
                  <p className="text-sm font-bold text-mairide-primary">{log.title}</p>
                  {log.detail ? <p className="mt-1 text-sm text-mairide-secondary">{log.detail}</p> : null}
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
              )) : (
                <div className="rounded-[22px] bg-mairide-bg p-4 text-sm text-mairide-secondary">
                  Fleet activity logs will appear here as vehicles are onboarded and settlement actions are created.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Mapped fleet earnings</p>
            <h2 className="mt-2 text-xl font-bold text-mairide-primary">Driver wallet and booking visibility</h2>
            <div className="mt-5 space-y-3">
              {fleetDrivers.length ? fleetDrivers.map((driver) => (
                <div key={driver.uid} className="rounded-[22px] bg-mairide-bg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-mairide-primary">{driver.displayName || driver.email || driver.uid}</p>
                      <p className="mt-1 text-xs text-mairide-secondary">{driver.phoneNumber || driver.email || 'Driver mapping pending contact details'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Pending INR</p>
                      <p className="mt-1 text-lg font-black text-mairide-primary">{formatCurrency(Number(driver.cashWallet?.pendingBalance || 0))}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-mairide-secondary md:grid-cols-3">
                    <div className="rounded-2xl bg-white px-3 py-2">Available: <span className="font-bold text-mairide-primary">{formatCurrency(Number(driver.cashWallet?.availableBalance || 0))}</span></div>
                    <div className="rounded-2xl bg-white px-3 py-2">Lifetime gross: <span className="font-bold text-mairide-primary">{formatCurrency(Number(driver.cashWallet?.lifetimeGross || 0))}</span></div>
                    <div className="rounded-2xl bg-white px-3 py-2">Fleet bookings: <span className="font-bold text-mairide-primary">{fleetBookings.filter((booking) => booking.driverId === driver.uid).length}</span></div>
                  </div>
                </div>
              )) : (
                <div className="rounded-[22px] bg-mairide-bg p-4 text-sm text-mairide-secondary">
                  No mapped drivers yet. Add the assigned driver UID inside each fleet vehicle so live rides, bookings, and earnings attach correctly.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {saveMessage ? (
        <div className="rounded-2xl border border-mairide-secondary bg-white px-5 py-4 text-sm font-medium text-mairide-primary shadow-sm">
          {saveMessage}
        </div>
      ) : null}
    </div>
  );
};

export const PartnerPortal = ({
  partner,
  currentUser,
  onPartnerUpdated,
}: {
  partner: B2BPartner;
  currentUser: User | null;
  onPartnerUpdated: (partner: B2BPartner) => void;
}) => {
  const [bookings, setBookings] = useState<PartnerBooking[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [fleetDrivers, setFleetDrivers] = useState<UserProfile[]>([]);
  const [fleetRides, setFleetRides] = useState<Ride[]>([]);
  const [fleetBookings, setFleetBookings] = useState<Booking[]>([]);

  useEffect(() => {
    let active = true;
    const reloadPartnerWorkspace = async () => {
      try {
        const nextBookings = await b2bPartnerService.listPartnerBookings(partner.id);
        if (!active) return;
        setBookings(nextBookings);

        if (partner.type === 'hotel_partner') {
          const nextRides = await b2bPartnerService.listDispatchableRides();
          if (!active) return;
          setRides(nextRides);
        } else {
          const driverIds = Array.from(new Set((partner.data?.fleetVehicles || []).map((vehicle) => vehicle.assignedDriverId).filter(Boolean))) as string[];
          const nextFleet = await b2bPartnerService.listFleetMappedRidesAndBookings(driverIds);
          if (!active) return;
          setFleetDrivers(nextFleet.drivers);
          setFleetRides(nextFleet.rides);
          setFleetBookings(nextFleet.bookings);
        }
      } catch {
        return;
      }
    };

    void reloadPartnerWorkspace();

    const channel = supabase.channel(`partner-portal-${partner.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_bookings', filter: `partner_id=eq.${partner.id}` }, () => {
        void reloadPartnerWorkspace();
      });

    if (partner.type === 'hotel_partner') {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
        void reloadPartnerWorkspace();
      });
    } else {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
          void reloadPartnerWorkspace();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
          void reloadPartnerWorkspace();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
          void reloadPartnerWorkspace();
        });
    }

    channel.subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [partner.data?.fleetVehicles, partner.id, partner.type]);

  if (partner.status !== 'approved') {
    return <PartnerStatusPanel partner={partner} />;
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-col gap-3 rounded-[28px] border border-mairide-secondary bg-white px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Signed in partner</p>
          <p className="mt-1 text-lg font-bold text-mairide-primary">{currentUser?.email || partner.email}</p>
        </div>
        <a
          href={partner.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm font-bold text-mairide-accent"
        >
          View verification document
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
      {partner.type === 'hotel_partner' ? (
        <HotelPartnerDashboard
          partner={partner}
          bookings={bookings}
          rides={rides}
          onPartnerUpdated={onPartnerUpdated}
          onBookingCreated={(booking) => setBookings((current) => [booking, ...current])}
        />
      ) : (
        <FleetPartnerDashboard
          partner={partner}
          bookings={bookings}
          fleetDrivers={fleetDrivers}
          fleetRides={fleetRides}
          fleetBookings={fleetBookings}
          onPartnerUpdated={onPartnerUpdated}
        />
      )}
    </div>
  );
};

const adminPartnerStatusTone: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const formatPartnerGeo = (partner: B2BPartner) => {
  if (partner.signupLatitude == null || partner.signupLongitude == null) {
    return 'Not captured';
  }

  return `${partner.signupLatitude.toFixed(5)}, ${partner.signupLongitude.toFixed(5)}`;
};

const B2BDeskSkeleton = () => (
  <div className="rounded-[36px] border border-mairide-secondary bg-white shadow-sm">
    <div className="border-b border-mairide-secondary px-8 py-6">
      <div className="h-3 w-36 animate-pulse rounded-full bg-mairide-bg" />
      <div className="mt-4 h-8 w-72 animate-pulse rounded-full bg-mairide-bg" />
      <div className="mt-3 h-4 w-[28rem] max-w-full animate-pulse rounded-full bg-mairide-bg" />
    </div>
    <div className="divide-y divide-mairide-secondary/30">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid gap-4 px-8 py-6 lg:grid-cols-[1.25fr_1fr_1fr_0.9fr_0.9fr_0.9fr_1.1fr]">
          {Array.from({ length: 7 }).map((__, cellIndex) => (
            <div key={cellIndex} className="space-y-3">
              <div className="h-3 w-24 animate-pulse rounded-full bg-mairide-bg" />
              <div className="h-5 w-full animate-pulse rounded-2xl bg-mairide-bg" />
              <div className="h-4 w-2/3 animate-pulse rounded-2xl bg-mairide-bg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

const B2BAdminModal = ({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
    <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-[36px] border border-mairide-secondary bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-mairide-secondary px-8 py-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Admin review</p>
          <h3 className="mt-2 text-2xl font-bold text-mairide-primary">{title}</h3>
          {subtitle ? <p className="mt-2 text-sm text-mairide-secondary">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-mairide-secondary p-3 text-mairide-secondary transition-colors hover:bg-mairide-bg hover:text-mairide-primary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[calc(90vh-112px)] overflow-y-auto p-8">{children}</div>
    </div>
  </div>
);

const B2BDocumentPreview = ({ url }: { url: string }) => {
  const isPdf = /\.pdf($|\?)/i.test(url);
  const isImage = /\.(png|jpe?g|webp|gif)($|\?)/i.test(url);

  if (isImage) {
    return <img src={url} alt="Verification document" className="h-full w-full rounded-[28px] object-contain" />;
  }

  if (isPdf) {
    return <iframe title="Verification document" src={url} className="h-[72vh] w-full rounded-[28px] border border-mairide-secondary" />;
  }

  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-mairide-secondary bg-mairide-bg p-8 text-center">
      <FileBadge2 className="h-10 w-10 text-mairide-accent" />
      <p className="mt-4 text-lg font-bold text-mairide-primary">Preview unavailable in-panel</p>
      <p className="mt-2 max-w-md text-sm text-mairide-secondary">This document type cannot be rendered directly here, but you can still open it in a new tab for verification.</p>
    </div>
  );
};

const B2BStatusActions = ({
  partner,
  updatingId,
  onUpdateStatus,
}: {
  partner: B2BPartner;
  updatingId: string | null;
  onUpdateStatus: (partnerId: string, status: ApprovalStatus) => Promise<void>;
}) => {
  const isBusy = updatingId === partner.id;

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        disabled={isBusy || partner.status === 'approved'}
        onClick={() => void onUpdateStatus(partner.id, 'approved')}
        className="inline-flex min-w-[7rem] items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve'}
      </button>
      <button
        type="button"
        disabled={isBusy || partner.status === 'rejected'}
        onClick={() => void onUpdateStatus(partner.id, 'rejected')}
        className="inline-flex min-w-[7rem] items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reject'}
      </button>
    </div>
  );
};

export const AdminB2BVerificationDesk = ({
  onPartnerUpdated,
  section = 'hotels',
}: {
  onPartnerUpdated?: (partner: B2BPartner) => void;
  section?: 'hotels' | 'fleets';
}) => {
  const [partners, setPartners] = useState<B2BPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savingCommissionId, setSavingCommissionId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [commissionDrafts, setCommissionDrafts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [documentPartner, setDocumentPartner] = useState<B2BPartner | null>(null);
  const [reviewPartner, setReviewPartner] = useState<B2BPartner | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const headers = await getAdminRequestHeaders();
        const response = await fetch('/api/admin-api?action=partner-list', { headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(payload?.error || 'Failed to load partner applications.'));
        }
        if (!active) return;
        const nextPartners = (Array.isArray(payload?.partners) ? payload.partners : []) as B2BPartner[];
        setPartners(nextPartners);
        setCommissionDrafts(
          nextPartners.reduce((accumulator: Record<string, string>, partner) => {
            accumulator[partner.id] = String(partner.commissionPercentage ?? 0);
            return accumulator;
          }, {})
        );
      } catch (error: any) {
        if (!active) return;
        setErrorMessage(String(error?.message || 'Failed to load partner applications.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const hotelPartners = useMemo(
    () => partners.filter((partner) => partner.type === 'hotel_partner'),
    [partners]
  );
  const fleetPartners = useMemo(
    () => partners.filter((partner) => partner.type === 'fleet_owner'),
    [partners]
  );
  const pendingPartners = useMemo(() => partners.filter((partner) => partner.status === 'pending'), [partners]);

  const activePartners = section === 'hotels' ? hotelPartners : fleetPartners;

  const mergePartner = (updated: B2BPartner) => {
    setPartners((current) => current.map((partner) => (partner.id === updated.id ? updated : partner)));
    setCommissionDrafts((current) => ({
      ...current,
      [updated.id]: String(updated.commissionPercentage ?? 0),
    }));
    onPartnerUpdated?.(updated);
  };

  const updateStatus = async (partnerId: string, status: ApprovalStatus) => {
    setUpdatingId(partnerId);
    setErrorMessage(null);
    try {
      const headers = await getAdminRequestHeaders();
      const response = await fetch('/api/admin-api?action=partner-set-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ partnerId, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.partner) {
        throw new Error(String(payload?.error || 'Failed to update partner status.'));
      }
      mergePartner(payload.partner as B2BPartner);
    } catch (error: any) {
      setErrorMessage(String(error?.message || 'Failed to update partner status.'));
    } finally {
      setUpdatingId(null);
    }
  };

  const saveCommission = async (partner: B2BPartner) => {
    const commissionPercentage = Number(commissionDrafts[partner.id]);
    if (!Number.isFinite(commissionPercentage) || commissionPercentage < 0 || commissionPercentage > 100) {
      setErrorMessage('Commission must be a valid percentage between 0 and 100.');
      return;
    }

    setSavingCommissionId(partner.id);
    setErrorMessage(null);
    try {
      const headers = await getAdminRequestHeaders();
      const response = await fetch('/api/admin-api?action=partner-update-commission', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ partnerId: partner.id, commissionPercentage }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.partner) {
        throw new Error(String(payload?.error || 'Failed to update hotel commission.'));
      }
      mergePartner(payload.partner as B2BPartner);
    } catch (error: any) {
      setErrorMessage(String(error?.message || 'Failed to update hotel commission.'));
    } finally {
      setSavingCommissionId(null);
    }
  };

  const deletePartner = async (partner: B2BPartner) => {
    const confirmed = window.confirm(`Delete ${partner.businessName} from the B2B partner system? This removes the partner record from the admin desk.`);
    if (!confirmed) return;

    setDeletingId(partner.id);
    setErrorMessage(null);
    try {
      const headers = await getAdminRequestHeaders();
      const response = await fetch('/api/admin-api?action=partner-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ partnerId: partner.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Failed to delete partner.'));
      }
      setPartners((current) => current.filter((currentPartner) => currentPartner.id !== partner.id));
      setCommissionDrafts((current) => {
        const next = { ...current };
        delete next[partner.id];
        return next;
      });
      if (documentPartner?.id === partner.id) setDocumentPartner(null);
      if (reviewPartner?.id === partner.id) setReviewPartner(null);
    } catch (error: any) {
      setErrorMessage(String(error?.message || 'Failed to delete partner.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-4">
        <PartnerStat label="Pending reviews" value={pendingPartners.length} detail="Applications waiting at the verification desk" />
        <PartnerStat label="Hotel partners" value={hotelPartners.length} detail="Properties onboarded into the desk console flow" />
        <PartnerStat label="Fleet operators" value={fleetPartners.length} detail="Fleet and travel businesses mapped into dispatch control" />
        <PartnerStat label="Approved partners" value={partners.filter((partner) => partner.status === 'approved').length} detail="Verified businesses with live access" />
      </div>

      <div className="rounded-[36px] border border-mairide-secondary bg-white shadow-sm">
        <div className="border-b border-mairide-secondary px-8 py-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Restricted admin workspace</p>
              <h2 className="mt-2 text-2xl font-bold text-mairide-primary">B2B Partner Hub</h2>
              <p className="mt-2 max-w-3xl text-sm text-mairide-secondary">
                {section === 'hotels'
                  ? 'Review hotel and resort onboarding, control commission assignments, and verify the desk-console partners before they go live.'
                  : 'Review fleet and travel operator onboarding, inspect uploaded trade documents, and clear verified operators into the partner stack.'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Active section</p>
                <p className="mt-2 text-lg font-black text-mairide-primary">
                  {section === 'hotels' ? 'Hotel & Resort Partners' : 'Fleet & Travel Operators'}
                </p>
              </div>
              <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Live rows</p>
                <p className="mt-2 text-lg font-black text-mairide-primary">{activePartners.length}</p>
              </div>
            </div>
          </div>
          {errorMessage ? <p className="mt-4 text-sm font-semibold text-red-600">{errorMessage}</p> : null}
        </div>

        {loading ? (
          <B2BDeskSkeleton />
        ) : section === 'hotels' ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-mairide-bg text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">
                  <th className="px-8 py-4">Business</th>
                  <th className="px-8 py-4">Contact</th>
                  <th className="px-8 py-4">GST Number</th>
                  <th className="px-8 py-4">Commission</th>
                  <th className="px-8 py-4">Status</th>
                  <th className="px-8 py-4">Geo-tag</th>
                  <th className="px-8 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mairide-secondary/30">
                {hotelPartners.length ? hotelPartners.map((partner) => (
                  <tr key={partner.id} className="align-top hover:bg-mairide-bg/40">
                    <td className="px-8 py-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-[20px] bg-mairide-bg p-3 text-mairide-accent">
                          <Hotel className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-base font-bold text-mairide-primary">{partner.businessName}</p>
                          <p className="mt-1 text-sm text-mairide-secondary">{partnerTypeMeta[partner.type].label}</p>
                          <p className="mt-2 text-xs text-mairide-secondary">{new Date(partner.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <p className="font-bold text-mairide-primary">{partner.contactPerson}</p>
                      <p className="mt-1 text-sm text-mairide-secondary">{partner.phone}</p>
                      <p className="mt-1 text-sm text-mairide-secondary">{partner.email}</p>
                    </td>
                    <td className="px-8 py-6">
                      <p className="font-bold text-mairide-primary">{partner.gstNumber || 'Not provided'}</p>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.1"
                            value={commissionDrafts[partner.id] ?? String(partner.commissionPercentage ?? 0)}
                            onChange={(event) => setCommissionDrafts((current) => ({ ...current, [partner.id]: event.target.value }))}
                            className="w-28 rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-2 text-sm font-bold text-mairide-primary outline-none focus:border-mairide-accent"
                          />
                          <button
                            type="button"
                            disabled={savingCommissionId === partner.id}
                            onClick={() => void saveCommission(partner)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-mairide-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                          >
                            {savingCommissionId === partner.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save
                          </button>
                        </div>
                        <p className="text-xs text-mairide-secondary">Assigned commission % on guest bookings</p>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn('inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]', adminPartnerStatusTone[partner.status])}>
                        {partner.status}
                      </span>
                    </td>
                    <td className="px-8 py-6">
                      <p className="font-bold text-mairide-primary">{formatPartnerGeo(partner)}</p>
                    </td>
                    <td className="px-8 py-6">
                      <div className="space-y-4">
                        <button
                          type="button"
                          onClick={() => setDocumentPartner(partner)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-mairide-secondary bg-white px-4 py-2 text-sm font-bold text-mairide-primary"
                        >
                          <Eye className="h-4 w-4" />
                          View Documents
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === partner.id}
                          onClick={() => void deletePartner(partner)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600 disabled:opacity-60"
                        >
                          {deletingId === partner.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Delete
                        </button>
                        <B2BStatusActions partner={partner} updatingId={updatingId} onUpdateStatus={updateStatus} />
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="px-8 py-12 text-sm text-mairide-secondary">
                      No hotel or resort partner applications found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-mairide-bg text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">
                  <th className="px-8 py-4">Fleet business</th>
                  <th className="px-8 py-4">Primary operator</th>
                  <th className="px-8 py-4">Contact details</th>
                  <th className="px-8 py-4">GST Number</th>
                  <th className="px-8 py-4">Fleet count</th>
                  <th className="px-8 py-4">Status</th>
                  <th className="px-8 py-4">Geo-tagging</th>
                  <th className="px-8 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mairide-secondary/30">
                {fleetPartners.length ? fleetPartners.map((partner) => {
                  const fleetCount = partner.data?.fleetVehicles?.length ?? 0;
                  return (
                    <tr key={partner.id} className="align-top hover:bg-mairide-bg/40">
                      <td className="px-8 py-6">
                        <div className="flex items-start gap-4">
                          <div className="rounded-[20px] bg-mairide-bg p-3 text-mairide-accent">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-base font-bold text-mairide-primary">{partner.businessName}</p>
                            <p className="mt-1 text-sm text-mairide-secondary">{partnerTypeMeta[partner.type].label}</p>
                            <p className="mt-2 text-xs text-mairide-secondary">{new Date(partner.createdAt).toLocaleString()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-mairide-primary">{partner.contactPerson}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-mairide-primary">{partner.phone}</p>
                        <p className="mt-1 text-sm text-mairide-secondary">{partner.email}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-mairide-primary">{partner.gstNumber || 'Not provided'}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-lg font-black text-mairide-primary">{fleetCount}</p>
                        <p className="mt-1 text-xs text-mairide-secondary">Registered vehicles</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn('inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]', adminPartnerStatusTone[partner.status])}>
                          {partner.status}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-mairide-primary">{formatPartnerGeo(partner)}</p>
                      </td>
                      <td className="px-8 py-6">
                        <div className="space-y-4">
                          <button
                            type="button"
                            onClick={() => setReviewPartner(partner)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-mairide-secondary bg-white px-4 py-2 text-sm font-bold text-mairide-primary"
                          >
                            <Eye className="h-4 w-4" />
                            Review Application
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === partner.id}
                            onClick={() => void deletePartner(partner)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600 disabled:opacity-60"
                          >
                            {deletingId === partner.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Delete
                          </button>
                          <B2BStatusActions partner={partner} updatingId={updatingId} onUpdateStatus={updateStatus} />
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={8} className="px-8 py-12 text-sm text-mairide-secondary">
                      No fleet or travel operator applications found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {documentPartner ? (
        <B2BAdminModal
          title={`${documentPartner.businessName} documents`}
          subtitle={`${documentPartner.contactPerson} • ${documentPartner.email}`}
          onClose={() => setDocumentPartner(null)}
        >
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Partner type</p>
                <p className="mt-2 font-bold text-mairide-primary">{partnerTypeMeta[documentPartner.type].label}</p>
              </div>
              <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">GST Number</p>
                <p className="mt-2 font-bold text-mairide-primary">{documentPartner.gstNumber || 'Not provided'}</p>
              </div>
              <div className="rounded-[24px] border border-mairide-secondary bg-mairide-bg p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Geo-location</p>
                <p className="mt-2 font-bold text-mairide-primary">{formatPartnerGeo(documentPartner)}</p>
              </div>
            </div>
            <B2BDocumentPreview url={documentPartner.documentUrl} />
            <a href={documentPartner.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-mairide-accent">
              Open verification document in a new tab
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </B2BAdminModal>
      ) : null}

      {reviewPartner ? (
        <B2BAdminModal
          title={`${reviewPartner.businessName} application review`}
          subtitle="Split review of fleet documents and signup coordinates"
          onClose={() => setReviewPartner(null)}
        >
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Verification document</p>
              <B2BDocumentPreview url={reviewPartner.documentUrl} />
            </div>
            <div className="space-y-4">
              <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Primary operator</p>
                <p className="mt-2 text-xl font-bold text-mairide-primary">{reviewPartner.contactPerson}</p>
                <p className="mt-2 text-sm text-mairide-secondary">{reviewPartner.email}</p>
                <p className="mt-1 text-sm text-mairide-secondary">{reviewPartner.phone}</p>
              </div>
              <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Geo-tagging metadata</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[20px] bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-mairide-secondary">Latitude</p>
                    <p className="mt-2 font-bold text-mairide-primary">
                      {reviewPartner.signupLatitude != null ? reviewPartner.signupLatitude.toFixed(6) : 'Unavailable'}
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-white p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-mairide-secondary">Longitude</p>
                    <p className="mt-2 font-bold text-mairide-primary">
                      {reviewPartner.signupLongitude != null ? reviewPartner.signupLongitude.toFixed(6) : 'Unavailable'}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-mairide-secondary">Mini-map is optional here, so this review surface keeps the raw geo-tagged coordinates visible for verification and audit.</p>
              </div>
              <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Registered fleet count</p>
                <p className="mt-2 text-3xl font-black text-mairide-primary">{reviewPartner.data?.fleetVehicles?.length ?? 0}</p>
                <p className="mt-2 text-sm text-mairide-secondary">Calculated from the partner profile payload without touching the traveler-driver booking flow.</p>
              </div>
              <B2BStatusActions partner={reviewPartner} updatingId={updatingId} onUpdateStatus={updateStatus} />
            </div>
          </div>
        </B2BAdminModal>
      ) : null}
    </div>
  );
};
