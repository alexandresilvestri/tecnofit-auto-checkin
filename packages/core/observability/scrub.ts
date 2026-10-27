type Event = {
  request?: unknown;
  user?: unknown;
  extra?: unknown;
  breadcrumbs?: unknown;
  exception?: { values?: { value?: string }[] };
};

export const scrub = <E extends Event>(event: E): E => ({
  ...event,
  request: undefined,
  user: undefined,
  extra: undefined,
  breadcrumbs: undefined,
  exception: event.exception && {
    ...event.exception,
    values: event.exception.values?.map((v) => ({ ...v, value: undefined })),
  },
});
