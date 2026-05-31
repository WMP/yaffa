<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Http\Requests\ImportProfileRequest;
use App\Models\ImportProfile;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controllers\HasMiddleware;
use Illuminate\Support\Facades\Gate;

class ImportProfileApiController extends Controller implements HasMiddleware
{
    public static function middleware(): array
    {
        return [
            ['auth:sanctum', 'verified'],
        ];
    }

    /**
     * @throws AuthorizationException
     */
    public function index(Request $request): JsonResponse
    {
        /**
         * @get('/api/import/csv/profiles')
         * @middlewares('api', 'auth:sanctum', 'verified')
         */
        Gate::authorize('viewAny', ImportProfile::class);

        $profiles = $request->user()
            ->importProfiles()
            ->when($request->get('q'), function ($query) use ($request) {
                $query->where('name', 'LIKE', '%' . $request->get('q') . '%');
            })
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get();

        return response()->json($profiles, Response::HTTP_OK);
    }

    /**
     * @throws AuthorizationException
     */
    public function show(ImportProfile $importProfile): JsonResponse
    {
        /**
         * @get('/api/import/csv/profiles/{importProfile}')
         * @middlewares('api', 'auth:sanctum', 'verified')
         */
        Gate::authorize('view', $importProfile);

        return response()->json($importProfile, Response::HTTP_OK);
    }

    /**
     * @throws AuthorizationException
     */
    public function store(ImportProfileRequest $request): JsonResponse
    {
        /**
         * @post('/api/import/csv/profiles')
         * @middlewares('api', 'auth:sanctum', 'verified')
         */
        Gate::authorize('create', ImportProfile::class);

        $validated = $request->validated();

        if ($validated['is_default'] ?? false) {
            $request->user()->importProfiles()->update(['is_default' => false]);
        }

        $profile = $request->user()->importProfiles()->create($validated);

        return response()->json($profile, Response::HTTP_CREATED);
    }

    /**
     * @throws AuthorizationException
     */
    public function update(ImportProfileRequest $request, ImportProfile $importProfile): JsonResponse
    {
        /**
         * @patch('/api/import/csv/profiles/{importProfile}')
         * @middlewares('api', 'auth:sanctum', 'verified')
         */
        Gate::authorize('update', $importProfile);

        $validated = $request->validated();

        if ($validated['is_default'] ?? false) {
            $request->user()
                ->importProfiles()
                ->where('id', '!=', $importProfile->id)
                ->update(['is_default' => false]);
        }

        $importProfile->update($validated);

        return response()->json($importProfile, Response::HTTP_OK);
    }

    /**
     * @throws AuthorizationException
     */
    public function destroy(ImportProfile $importProfile): JsonResponse
    {
        /**
         * @delete('/api/import/csv/profiles/{importProfile}')
         * @middlewares('api', 'auth:sanctum', 'verified')
         */
        Gate::authorize('delete', $importProfile);

        $importProfile->delete();

        return response()->json([], Response::HTTP_NO_CONTENT);
    }
}
