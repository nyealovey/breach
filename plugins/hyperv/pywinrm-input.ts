import { buildKerberosSpnStrategy } from './kerberos-spn';

export type PywinrmInputOptions = {
  host: string;
  port: number;
  useHttps: boolean;
  rejectUnauthorized: boolean;
  rawUsername: string;
  password: string;
  kerberosServiceName: string | undefined;
  kerberosSpnFallback: boolean | undefined;
  kerberosHostnameOverride: string | undefined;
};

export function buildPywinrmInput(opts: PywinrmInputOptions, script: string): Record<string, unknown> {
  const spnStrategy = buildKerberosSpnStrategy({
    host: opts.host,
    preferredServiceName: opts.kerberosServiceName,
    enableFallback: opts.kerberosSpnFallback ?? false,
    hostnameOverride: opts.kerberosHostnameOverride,
  });

  return {
    host: opts.host,
    port: opts.port,
    use_https: opts.useHttps,
    username: opts.rawUsername,
    password: opts.password,
    script,
    transport: 'kerberos',
    server_cert_validation: opts.rejectUnauthorized ? 'validate' : 'ignore',
    kerberos_service_candidates: spnStrategy.serviceCandidates,
    kerberos_hostname_overrides: spnStrategy.hostnameOverrides,
  };
}
