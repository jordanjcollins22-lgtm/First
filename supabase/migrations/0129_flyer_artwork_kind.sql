-- Whether the advertiser sent a finished advert or a reference.
--
-- Most local businesses do not have a print-ready 4 by 4.75 at 300 DPI. They
-- have a photo of last year's newspaper ad and a logo somewhere. Refusing
-- those loses the sale; taking them without recording which is which is how
-- somebody's holiday snap ends up on 2,500 flyers.

alter table flyer_bookings add column if not exists artwork_kind text
  not null default 'ready'
  check (artwork_kind in ('ready', 'reference'));

comment on column flyer_bookings.artwork_kind is
  'ready = print it as sent. reference = they want us to design the advert from this.';

notify pgrst, 'reload schema';
