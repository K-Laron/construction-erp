export interface Delivery {
  id: string;
  transaction_id: string;
  delivery_date: string;
  driver_name: string;
  truck_plate: string;
  status: 'Pending' | 'Dispatched' | 'Delivered';
}

export interface DeliveryItem {
  id: string;
  delivery_id: string;
  item_id: string;
  quantity_delivered: number;
}
