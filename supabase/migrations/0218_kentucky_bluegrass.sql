-- Kentucky bluegrass: the lawn, in the beds.
--
-- It is a turf grass and not a weed anywhere it was planted, which is why the
-- guide never had it. In a mulch bed it is a weed like any other: it creeps in
-- from the lawn on underground runners and then stands straight up, because
-- nothing in a bed mows it. The crew has to be able to name it, and to know
-- that pulling the clump without the runners just moves the problem.
--
-- Crew reference only, like the tall fescue clumps and the quackgrass beside
-- it. The client's handout is weeds a homeowner points at; their own grass in
-- the wrong place is not that conversation.
--
-- Added for every business that already has the guide, in the place the seed
-- list now puts it -- straight after annual bluegrass, so the two Poas are
-- next to each other and a crew can tell them apart. New businesses get it
-- from the seed and never reach this.

DO $$
DECLARE
  the_org uuid;
  anchor integer;
BEGIN
  FOR the_org IN SELECT DISTINCT organization_id FROM weeds LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM weeds WHERE organization_id = the_org AND slug = 'poa-pratensis'
    );

    -- Where annual bluegrass sits for this business, whatever anybody has
    -- since reordered. Failing that, the end of their list.
    SELECT position INTO anchor
      FROM weeds WHERE organization_id = the_org AND slug = 'poa-annua';
    IF anchor IS NULL THEN
      SELECT coalesce(max(position), -1) INTO anchor FROM weeds WHERE organization_id = the_org;
    END IF;

    UPDATE weeds SET position = position + 1
      WHERE organization_id = the_org AND position > anchor;

    INSERT INTO weeds (
      organization_id, slug, common_name, scientific_name, weed_group,
      on_client_sheet, code, position, prep
    )
    VALUES (
      the_org,
      'poa-pratensis',
      'Kentucky Bluegrass',
      'Poa pratensis',
      'Grassy weeds',
      false,
      weed_code(the_org),
      anchor + 1,
      -- First line is the one the printed sheet has room for; the rest is for
      -- whoever scans the code, where there is room for it.
      'Take the runners too.' || chr(10) ||
      'Creeps into beds from the lawn on underground runners, then stands straight up ' ||
      'a foot or more because nothing in a bed mows it. Boat-shaped leaf tip, two pale ' ||
      'lines either side of the midrib. Pull the clump and leave the runners and it is ' ||
      'back in a month. Tall fescue clumps and quackgrass do the same thing in a bed ' ||
      'and are both coarser in the blade.'
    );
  END LOOP;
END $$;
