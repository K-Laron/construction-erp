"use client";

import { useState, useEffect } from 'react';
import { logger } from "@/lib/logger";
import { getStoreStatus, lockStoreAction } from '@/app/actions/store';
import UnlockScreen from '@/components/UnlockScreen';
import LoginScreen from '@/components/LoginScreen';
import DashboardLayout from '@/components/ui/DashboardLayout';
import POSRegister from '@/components/pos/POSRegister';
import ShiftBar from '@/components/pos/ShiftBar';
import CustomerManager from '@/components/crm/CustomerManager';
import InventoryManager from '@/components/inventory/InventoryManager';
import DeliveryDispatch from '@/components/deliveries/DeliveryDispatch';
import ReportsPanel from '@/components/reports/ReportsPanel';
import MaintenancePanel from '@/components/maintenance/MaintenancePanel';
import A5PrintReceipt from '@/components/print/A5PrintReceipt';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function Home() {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [isUnlocked, setIsUnlocked] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<any | null>(null);

  const [activeView, setActiveView] = useState('pos');
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);

  const [printData, setPrintData] = useState<{ transaction: any; items: any[]; customerName?: string } | null>(null);

  const checkStatus = async () => {
    try {
      const status = await getStoreStatus();
      setIsConfigured(status.isConfigured);
      setIsUnlocked(status.isUnlocked);
    } catch (err) {
      logger.error(String(err), err);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleLockStore = async () => {
    await lockStoreAction();
    setIsUnlocked(false);
    setCurrentUser(null);
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  if (isConfigured === null || isUnlocked === null) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center text-interactive-400 text-sm">
        Connecting to local ERP node...
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <UnlockScreen
        isFirstBoot={!isConfigured}
        onUnlockSuccess={() => {
          setIsUnlocked(true);
          setIsConfigured(true);
        }}
      />
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(user) => {
          setCurrentUser(user);
        }}
      />
    );
  }

  const renderActiveView = () => {
    switch (activeView) {
      case 'pos':
        return (
          <div className="flex-1 flex flex-col min-h-0">
            <POSRegister
              cashierId={currentUser.id}
              onCheckoutSuccess={(txn) => {
                setPrintData({
                  transaction: txn.payload,
                  items: txn.payload.items,
                  customerName: txn.customerName
                });
              }}
            />
            <ShiftBar
              cashierId={currentUser.id}
              cashierName={currentUser.name}
              onShiftChange={setActiveShiftId}
            />
          </div>
        );
      case 'customers':
        return <CustomerManager />;
      case 'inventory':
        return <InventoryManager />;
      case 'deliveries':
        return <DeliveryDispatch />;
      case 'reports':
        return <ReportsPanel />;
      case 'maintenance':
        return <MaintenancePanel currentUser={currentUser} />;
      default:
        return <div className="p-6 text-interactive-400">View not found</div>;
    }
  };

  return (
    <>
      {printData && (
        <div className="hidden print:block">
          <A5PrintReceipt
            transaction={printData.transaction}
            items={printData.items}
            customerName={printData.customerName}
          />
        </div>
      )}

      <div className="flex-1 flex min-h-screen flex-col bg-surface-950 text-interactive-500 print:hidden">
        <DashboardLayout
          activeView={activeView}
          onNavigate={(view) => {
            if (view === 'lock') {
              handleLockStore();
            } else if (view === 'logout') {
              handleLogout();
            } else {
              setActiveView(view);
            }
          }}
          currentUser={currentUser}
          isUnlocked={isUnlocked}
        >
          <ErrorBoundary key={activeView}>
            {renderActiveView()}
          </ErrorBoundary>
        </DashboardLayout>
      </div>
    </>
  );
}
