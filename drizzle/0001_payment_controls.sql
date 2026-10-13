CREATE UNIQUE INDEX unique_purchase_po ON records(parent,json_extract(data,'$.po')) WHERE kind='purchase';
