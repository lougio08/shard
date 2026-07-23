export interface SkyCoflBazaarSnapshot {
  productId: string;
  buyPrice: number;
  buyVolume: number;
  buyMovingWeek: number;
  buyOrdersCount: number;
  sellPrice: number;
  sellVolume: number;
  sellMovingWeek: number;
  sellOrdersCount: number;
  timeStamp: string;
}
