-- One-off: tell the imported payments which invoice each one settled.
--
-- The 98 payments imported from Stripe arrived with no invoice reference, so
-- the Received tab could only group them by how close together they fell.
-- Time is a guess. The charge metadata knows the answer: 48 of them name the
-- GoHighLevel invoice they paid, and invoice 000052 alone is five charges
-- across a spring that belong to one job.
--
-- Safe to run more than once — it matches on the payment intent id, which is
-- unique, and only fills a column that is null.
--
-- Requires 0117_payment_invoice_ref.sql.

update payments p
set source_invoice_ref = v.ref
from (values
  ('pi_3U71n32MZOhyTasU1Q9jaSEq','6a2de9a3dd303b8a05d4dce2'),
  ('pi_3U2XyD2MZOhyTasU1oipAZCe','6a78920172500aacee23500b'),
  ('pi_3U1pqU2MZOhyTasU0DlRtbO4','6a75fb9e20bafa1f4da3e45b'),
  ('pi_3TvLIe2MZOhyTasU0w1jZJ02','6a5e584a33d40ae66e52b015'),
  ('pi_3TrcMW2MZOhyTasU0pGSEUAu','6a2de9a3dd303b8a05d4dce2'),
  ('pi_3TqDId2MZOhyTasU0Zhh0W5E','6a4bb82347e9a97ebb9c2643'),
  ('pi_3TpHPf2MZOhyTasU1mcTI9LF','6a46e3d737e6043c1271084c'),
  ('pi_3Tifmz2MZOhyTasU0bvfdZc2','6a1d8538e0c00dd7b518d21a'),
  ('pi_3TiC412MZOhyTasU01Oa7jWo','6a2de9a3dd303b8a05d4dce2'),
  ('pi_3TdWZi2MZOhyTasU1bDwGYJ3','6a1d8538e0c00dd7b518d21a'),
  ('pi_3TZy8B2MZOhyTasU0BjLorGh','6a10a2cb59204836a0482984'),
  ('pi_3TYruo2MZOhyTasU1nr5sIwg','6a0ca2f21d2e91d8c312df48'),
  ('pi_3TYSLh2MZOhyTasU1DExUlq8','6a0b245e6433ec71caca0557'),
  ('pi_3TXLGg2MZOhyTasU1WWYdqLx','6a0717078e10a0ce4d7d480f'),
  ('pi_3TTA8E2MZOhyTasU0lkgAoVH','69f7e469b38162df12b4903f'),
  ('pi_3TOgjB2MZOhyTasU0cT4nGvq','69e79dd044ec720e54ab79c2'),
  ('pi_3TOSGA2MZOhyTasU0OmGB4Uj','69e63c40fd329430c36f6b94'),
  ('pi_3TLNq12MZOhyTasU1ulJZNbx','69db98638991c9436abf2958'),
  ('pi_3TL2Ux2MZOhyTasU0ViHCwbh','69d793dff70dc52135a4a52a'),
  ('pi_3TJztJ2MZOhyTasU0rQ8dPFw','69d68fc612347bdd2938461e'),
  ('pi_3TJzCs2MZOhyTasU0KA2LQS6','69d682bf4ad39edcf4cb50b4'),
  ('pi_3THpy82MZOhyTasU0sWxIlRc','69ceb48fcb18b9696e34ae6e'),
  ('pi_3TGoKD2MZOhyTasU0IH8BWlP','69caab04ffff6897390d68c1'),
  ('pi_3T0QN12MZOhyTasU0sSvwfk4','698f621773964380d68f4c5d'),
  ('pi_3Sv3Qf2MZOhyTasU1Ql19wRu','697bd7ff255b454e8575a9ad'),
  ('pi_3Sv3CR2MZOhyTasU1h0kghQB','697bd65d174bea23007a3c23'),
  ('pi_3Sv0kC2MZOhyTasU0BSmb2vV','697bafc6174beac0647703cc'),
  ('pi_3Suzui2MZOhyTasU0Z1zZ05s','697b9f91174bea597c75825c'),
  ('pi_3SuzYr2MZOhyTasU1lx9jfhz','697ba027174bea0b66758f86'),
  ('pi_3Suyyu2MZOhyTasU0P4w3S2O','697b97ab174bea9cff74c26a'),
  ('pi_3StpPV2MZOhyTasU0jzVhfrs','6977651f7f934be436aa527d'),
  ('pi_3So4DB2MZOhyTasU1c3hbTSp','6962716dd6b0ab2a93f269d3'),
  ('pi_3SnIx52MZOhyTasU1VqJcRCY','695fabebe27adc1944d681cc'),
  ('pi_3Segz62MZOhyTasU0F0azVzd','694053998b7f407d263f64fe'),
  ('pi_3Se3Wx2MZOhyTasU1Oq6tlio','693adb7021e553743933e103'),
  ('pi_3SUcnT2MZOhyTasU1CRamiLq','691bbd9be71a3040d565031d'),
  ('pi_3SUSp12MZOhyTasU1MF7f2z6','691773e8cdd79c35a8aba48f'),
  ('pi_3SToac2MZOhyTasU09LG11XF','6918cbc853fab6aa5165072a'),
  ('pi_3S9cA82MZOhyTasU1ruBDgjF','68cf54ad55e1f56458b29632'),
  ('pi_3S0rPq2MZOhyTasU0dSaVCwq','68af802e425d6c7f22f2ea60'),
  ('pi_3S05zi2MZOhyTasU1LRzRN8R','686f37308dd2d00f0fc0b714'),
  ('pi_3Ru4Yy2MZOhyTasU0behdF98','6896d0dca04c115d11d55e48'),
  ('pi_3Ro0kK2MZOhyTasU1rcLGhXt','687552ed9fbaf10ea06505b6'),
  ('pi_3RndyG2MZOhyTasU12r7DjVD','686d9e16e9d90296cb853a66'),
  ('pi_3RnK0N2MZOhyTasU0ywVsSpb','686d9e16e9d90296cb853a66'),
  ('pi_3RlVsp2MZOhyTasU1o9MhdjE','686f36b3828e1b5b26f8d9cb')
  ,('pi_3RlUbj2MZOhyTasU01p4GGGG','687552ed9fbaf10ea06505b6'),
  ('pi_3Rl7rv2MZOhyTasU1VKq0o5o','686d9e16e9d90296cb853a66')
) as v(pi, ref)
where p.stripe_payment_intent_id = v.pi
  and p.source_invoice_ref is null;

-- What landed: how many payments now name an invoice, and how many invoices
-- have more than one payment on them (the ones that become a single project).
select
  count(source_invoice_ref) as payments_with_an_invoice,
  (select count(*) from (
     select source_invoice_ref from payments
     where source_invoice_ref is not null
     group by 1 having count(*) > 1
   ) x) as invoices_paid_in_instalments
from payments;
