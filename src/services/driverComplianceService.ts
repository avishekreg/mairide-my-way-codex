import { UserProfile } from '../types';

export type DriverComplianceDocument = {
  key: 'driving_license' | 'vehicle_insurance' | 'vehicle_registration';
  label: string;
  expiryDate: string;
  daysRemaining: number;
};

export type DriverComplianceResult = {
  isRideLocked: boolean;
  pendingReverification: boolean;
  expiredDocuments: DriverComplianceDocument[];
  expiringDocuments: DriverComplianceDocument[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getStartOfDay = (value: Date) => {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
};

export const checkDriverDocumentValidity = (
  profile: Pick<UserProfile, 'driverDetails'>,
  currentDate = new Date()
): DriverComplianceResult => {
  const details = profile.driverDetails;
  const today = getStartOfDay(currentDate);
  const documents = [
    { key: 'driving_license' as const, label: 'Driving License', expiryDate: details?.dlExpiryDate || '' },
    { key: 'vehicle_insurance' as const, label: 'Vehicle Insurance', expiryDate: details?.insuranceExpiryDate || '' },
    { key: 'vehicle_registration' as const, label: 'Vehicle Registration/RC', expiryDate: details?.rcExpiryDate || '' },
  ]
    .filter((document) => Boolean(document.expiryDate))
    .map((document) => {
      const expiry = getStartOfDay(new Date(`${document.expiryDate}T00:00:00`));
      return {
        ...document,
        daysRemaining: Number.isNaN(expiry.getTime())
          ? Number.POSITIVE_INFINITY
          : Math.ceil((expiry.getTime() - today.getTime()) / MS_PER_DAY),
      };
    });

  const expiredDocuments = documents.filter((document) => document.daysRemaining < 0);
  const expiringDocuments = documents.filter(
    (document) => document.daysRemaining >= 0 && document.daysRemaining <= 15
  );
  const pendingReverification = Boolean(details?.complianceReverificationPending);

  return {
    isRideLocked: expiredDocuments.length > 0 || pendingReverification,
    pendingReverification,
    expiredDocuments,
    expiringDocuments,
  };
};
