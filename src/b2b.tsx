import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowUpRight,
  Building2,
  Car,
  CheckCircle2,
  Clock3,
  FileBadge2,
  Globe2,
  Hotel,
  IndianRupee,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { cn, formatCurrency } from './lib/utils';
import { b2bPartnerService } from './services/b2bPartnerService';
import type { ApprovalStatus, B2BPartner, PartnerBooking, PartnerType, PartnerVehicle, Ride } from './types';

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
  const response = await fetch('/api/partner-api?action=submit-application', {
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
  const [commissionRequest, setCommissionRequest] = useState(
    String((partner.data?.commissionRequest?.requestedPercentage ?? partner.commissionPercentage) || 0)
  );
  const [commissionNote, setCommissionNote] = useState(partner.data?.commissionRequest?.note || '');
  const [deskForm, setDeskForm] = useState({
    guestName: '',
    guestPhone: '',
    pickup: '',
    dropoff: '',
    pickupTime: '',
    rideId: '',
    quotedFare: '',
    paymentPreference: 'secure_pay' as NonNullable<PartnerBooking['data']>['paymentPreference'],
  });
  const [isSavingCommission, setIsSavingCommission] = useState(false);
  const [isCreatingDeskBooking, setIsCreatingDeskBooking] = useState(false);
  const [deskNotice, setDeskNotice] = useState<string | null>(null);

  const submitCommissionRequest = async () => {
    setIsSavingCommission(true);
    try {
      const updated = await b2bPartnerService.updatePartnerProfile(partner.id, {
        data: {
          ...(partner.data || {}),
          commissionRequest: {
            requestedPercentage: Number(commissionRequest || 0),
            note: commissionNote.trim(),
            status: 'requested',
            updatedAt: new Date().toISOString(),
          },
        },
      });
      onPartnerUpdated(updated);
    } finally {
      setIsSavingCommission(false);
    }
  };

  const createDeskBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsCreatingDeskBooking(true);
    setDeskNotice(null);
    try {
      const selectedRide = rides.find((ride) => ride.id === deskForm.rideId);
      const totalFare = Number(deskForm.quotedFare || selectedRide?.price || 0);
      const partnerCut = Number(((totalFare * partner.commissionPercentage) / 100).toFixed(2));
      const driverCut = Number((totalFare - partnerCut).toFixed(2));
      const createdBooking = await b2bPartnerService.createPartnerBooking({
        partnerId: partner.id,
        totalFare,
        partnerCut,
        driverCut,
        data: {
          guestName: deskForm.guestName,
          guestPhone: deskForm.guestPhone,
          pickup: deskForm.pickup,
          dropoff: deskForm.dropoff,
          pickupTime: deskForm.pickupTime,
          rideLabel: selectedRide ? `${selectedRide.origin} → ${selectedRide.destination}` : `${deskForm.pickup} → ${deskForm.dropoff}`,
          coreRideId: selectedRide?.id,
          bookingSource: 'hotel_desk',
          paymentPreference: deskForm.paymentPreference,
        },
      });
      onBookingCreated(createdBooking);
      setDeskForm({
        guestName: '',
        guestPhone: '',
        pickup: '',
        dropoff: '',
        pickupTime: '',
        rideId: '',
        quotedFare: '',
        paymentPreference: 'secure_pay',
      });
      setDeskNotice('Guest desk booking logged successfully. Settlement can now flow through the isolated partner ledger.');
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
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Commission control</p>
              <h2 className="mt-2 text-xl font-bold text-mairide-primary">Custom commission setting</h2>
            </div>
            <div className="rounded-[22px] bg-mairide-bg px-4 py-3 text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Current live rate</p>
              <p className="mt-1 text-2xl font-black text-mairide-primary">{partner.commissionPercentage.toFixed(2)}%</p>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Requested commission percentage</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={commissionRequest}
                onChange={(event) => setCommissionRequest(event.target.value)}
                className="w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">Commercial note</span>
              <textarea
                value={commissionNote}
                onChange={(event) => setCommissionNote(event.target.value)}
                className="min-h-[120px] w-full rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                placeholder="Why should MaiRide adjust this property’s revenue share?"
              />
            </label>
            <button
              type="button"
              onClick={submitCommissionRequest}
              disabled={isSavingCommission}
              className="rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-mairide-accent disabled:opacity-60"
            >
              {isSavingCommission ? 'Saving request...' : 'Save commission request'}
            </button>
          </div>
        </div>

        <div className="rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Desk console</p>
          <h2 className="mt-2 text-xl font-bold text-mairide-primary">Book a ride for a guest</h2>
          <p className="mt-2 text-sm text-mairide-secondary">This console creates an isolated partner ledger entry while preserving the core traveler-driver flow untouched.</p>
          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={createDeskBooking}>
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Guest name" value={deskForm.guestName} onChange={(event) => setDeskForm((current) => ({ ...current, guestName: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Guest phone" value={deskForm.guestPhone} onChange={(event) => setDeskForm((current) => ({ ...current, guestPhone: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Pickup" value={deskForm.pickup} onChange={(event) => setDeskForm((current) => ({ ...current, pickup: event.target.value }))} required />
            <input className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" placeholder="Dropoff" value={deskForm.dropoff} onChange={(event) => setDeskForm((current) => ({ ...current, dropoff: event.target.value }))} required />
            <input type="datetime-local" className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={deskForm.pickupTime} onChange={(event) => setDeskForm((current) => ({ ...current, pickupTime: event.target.value }))} />
            <select className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" value={deskForm.rideId} onChange={(event) => setDeskForm((current) => ({ ...current, rideId: event.target.value, quotedFare: event.target.value ? String(rides.find((ride) => ride.id === event.target.value)?.price || '') : current.quotedFare }))}>
              <option value="">Select an available ride</option>
              {rides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {ride.origin} → {ride.destination} ({formatCurrency(ride.price)})
                </option>
              ))}
            </select>
            <input type="number" min="0" className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent" placeholder="Fare to log" value={deskForm.quotedFare} onChange={(event) => setDeskForm((current) => ({ ...current, quotedFare: event.target.value }))} required />
            <select className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-4 text-sm font-medium text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent md:col-span-2" value={deskForm.paymentPreference} onChange={(event) => setDeskForm((current) => ({ ...current, paymentPreference: event.target.value as NonNullable<PartnerBooking['data']>['paymentPreference'] }))}>
              <option value="secure_pay">Collect Online via MaiRide Secure Pay</option>
              <option value="cash">Manual cash fallback</option>
              <option value="hybrid">Hybrid settlement</option>
            </select>
            {deskNotice ? <div className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-3 text-sm text-mairide-primary md:col-span-2">{deskNotice}</div> : null}
            <button type="submit" disabled={isCreatingDeskBooking} className="rounded-2xl bg-mairide-primary px-5 py-4 text-sm font-bold text-white transition-colors hover:bg-mairide-accent disabled:opacity-60 md:col-span-2">
              {isCreatingDeskBooking ? 'Creating desk booking...' : 'Create guest booking'}
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
  onPartnerUpdated,
}: {
  partner: B2BPartner;
  bookings: PartnerBooking[];
  onPartnerUpdated: (partner: B2BPartner) => void;
}) => {
  const fleetVehicles = partner.data?.fleetVehicles || [];
  const liveLogs = partner.data?.liveLogs || [];
  const payoutModel = partner.data?.payoutModel || { model: 'per_ride_cut', value: 0, description: '' };
  const totalGross = bookings.reduce((sum, booking) => sum + booking.totalFare, 0);
  const activeVehicles = fleetVehicles.filter((vehicle) => vehicle.status === 'active').length;
  const [vehicleDraft, setVehicleDraft] = useState<PartnerVehicle>({
    id: '',
    label: '',
    registrationNumber: '',
    assignedDriverName: '',
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
        <PartnerStat label="Gross fares tracked" value={formatCurrency(totalGross)} detail="From the isolated partner ledger only" />
        <PartnerStat label="Pending settlements" value={bookings.filter((booking) => booking.settlementStatus === 'pending').length} detail="Awaiting downstream batch settlement" />
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
                  <div className="font-medium text-mairide-primary">{vehicle.assignedDriverName || 'Unassigned'}</div>
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

  useEffect(() => {
    let active = true;
    void b2bPartnerService.listPartnerBookings(partner.id).then((result) => {
      if (active) setBookings(result);
    }).catch(() => undefined);
    if (partner.type === 'hotel_partner') {
      void b2bPartnerService.listDispatchableRides().then((result) => {
        if (active) setRides(result);
      }).catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [partner.id, partner.type]);

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
        <FleetPartnerDashboard partner={partner} bookings={bookings} onPartnerUpdated={onPartnerUpdated} />
      )}
    </div>
  );
};

export const AdminB2BVerificationDesk = ({
  onPartnerUpdated,
}: {
  onPartnerUpdated?: (partner: B2BPartner) => void;
}) => {
  const [partners, setPartners] = useState<B2BPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const headers = await getAdminRequestHeaders();
        const response = await fetch('/api/partner-api?action=list', { headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(payload?.error || 'Failed to load partner applications.'));
        }
        if (!active) return;
        setPartners(Array.isArray(payload?.partners) ? payload.partners : []);
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

  const pendingPartners = useMemo(() => partners.filter((partner) => partner.status === 'pending'), [partners]);

  const updateStatus = async (partnerId: string, status: ApprovalStatus) => {
    setUpdatingId(partnerId);
    setErrorMessage(null);
    try {
      const headers = await getAdminRequestHeaders();
      const response = await fetch('/api/partner-api?action=set-status', {
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
      const updated = payload.partner as B2BPartner;
      setPartners((current) => current.map((partner) => (partner.id === updated.id ? updated : partner)));
      onPartnerUpdated?.(updated);
    } catch (error: any) {
      setErrorMessage(String(error?.message || 'Failed to update partner status.'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-3">
        <PartnerStat label="Pending reviews" value={pendingPartners.length} detail="Applications awaiting action from the admin desk" />
        <PartnerStat label="Approved partners" value={partners.filter((partner) => partner.status === 'approved').length} />
        <PartnerStat label="Rejected partners" value={partners.filter((partner) => partner.status === 'rejected').length} />
      </div>

      <div className="rounded-[36px] border border-mairide-secondary bg-white shadow-sm">
        <div className="border-b border-mairide-secondary px-8 py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Restricted admin view</p>
          <h2 className="mt-2 text-2xl font-bold text-mairide-primary">B2B Verification Desk</h2>
          <p className="mt-2 text-sm text-mairide-secondary">Review business documents, GST numbers, and geo-tagged signup coordinates before opening either partner dashboard.</p>
          {errorMessage ? (
            <p className="mt-3 text-sm font-semibold text-red-600">{errorMessage}</p>
          ) : null}
        </div>
        <div className="divide-y divide-mairide-secondary/30">
          {loading ? (
            <div className="px-8 py-10 text-sm text-mairide-secondary">Loading partner applications…</div>
          ) : pendingPartners.length ? pendingPartners.map((partner) => {
            const Icon = partner.type === 'hotel_partner' ? Hotel : Building2;
            return (
              <div key={partner.id} className="grid gap-6 px-8 py-7 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="rounded-[22px] bg-mairide-bg p-3 text-mairide-accent">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{partnerTypeMeta[partner.type].eyebrow}</p>
                      <h3 className="mt-2 text-xl font-bold text-mairide-primary">{partner.businessName}</h3>
                      <p className="mt-1 text-sm text-mairide-secondary">{partner.contactPerson} • {partner.email} • {partner.phone}</p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-[22px] bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">GSTIN</p>
                      <p className="mt-2 text-sm font-bold text-mairide-primary">{partner.gstNumber || 'Not provided'}</p>
                    </div>
                    <div className="rounded-[22px] bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Signup latitude</p>
                      <p className="mt-2 text-sm font-bold text-mairide-primary">{partner.signupLatitude?.toFixed(6) || 'Unavailable'}</p>
                    </div>
                    <div className="rounded-[22px] bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Signup longitude</p>
                      <p className="mt-2 text-sm font-bold text-mairide-primary">{partner.signupLongitude?.toFixed(6) || 'Unavailable'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">Verification actions</p>
                  <a href={partner.documentUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-mairide-accent">
                    Open uploaded document
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      disabled={updatingId === partner.id}
                      onClick={() => updateStatus(partner.id, 'approved')}
                      className="flex-1 rounded-2xl bg-green-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === partner.id}
                      onClick={() => updateStatus(partner.id, 'rejected')}
                      className="flex-1 rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-sm font-bold text-mairide-primary disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="px-8 py-12 text-sm text-mairide-secondary">
              No pending B2B partner applications right now.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
