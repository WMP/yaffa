<?php

namespace App\Providers;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Laravel\Telescope\EntryType;
use Laravel\Telescope\IncomingEntry;
use Laravel\Telescope\Telescope;
use Laravel\Telescope\TelescopeApplicationServiceProvider;

class TelescopeServiceProvider extends TelescopeApplicationServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        Telescope::night();

        $this->hideSensitiveRequestDetails();

        Telescope::tag(function (IncomingEntry $entry) {
            if ($this->isMonitoredRequestPath()) {
                return ['monitor:categories'];
            }

            return [];
        });

        Telescope::filter(function (IncomingEntry $entry) {
            if ($this->app->environment('local')) {
                return true;
            }

            return $entry->isReportableException() ||
                $entry->isFailedRequest() ||
                $entry->type === EntryType::JOB || // Keep all jobs
                $entry->type === EntryType::EVENT || // Keep all events
                $entry->isSlowQuery() ||
                $entry->isScheduledTask() ||
                $this->hasCategoriesMonitorTag($entry) ||
                $entry->hasMonitoredTag();
        });

        Telescope::filterBatch(function (Collection $entries) {
            if ($this->app->environment('local')) {
                return $entries;
            }

            return $entries->filter(fn (IncomingEntry $entry) => $entry->isReportableException() ||
                    $entry->isFailedRequest() ||
                    $entry->type === EntryType::JOB || // Keep all jobs
                    $entry->type === EntryType::EVENT || // Keep all events
                    $entry->isSlowQuery() ||
                    $entry->isScheduledTask() ||
                    $this->hasCategoriesMonitorTag($entry) ||
                    $entry->hasMonitoredTag());
        });
    }

    private function isMonitoredRequestPath(): bool
    {
        if (!config('telescope.monitor_categories')) {
            return false;
        }

        if ($this->app->runningInConsole()) {
            return false;
        }

        $request = request();
        foreach (config('telescope.monitor_paths', []) as $pattern) {
            if ($request->is($pattern)) {
                return true;
            }
        }

        return false;
    }

    private function hasCategoriesMonitorTag(IncomingEntry $entry): bool
    {
        return in_array('monitor:categories', $entry->tags ?? [], true);
    }

    /**
     * Prevent sensitive request details from being logged by Telescope.
     */
    protected function hideSensitiveRequestDetails()
    {
        if ($this->app->environment('local')) {
            return;
        }

        Telescope::hideRequestParameters(['_token']);

        Telescope::hideRequestHeaders([
            'cookie',
            'x-csrf-token',
            'x-xsrf-token',
        ]);
    }

    /**
     * Register the Telescope gate.
     *
     * This gate determines who can access Telescope in non-local environments.
     */
    protected function gate()
    {
        Gate::define(
            'viewTelescope',
            fn ($user) => in_array($user->email, [
                config('yaffa.admin_email'),
            ])
        );
    }
}
